'use strict';
const zlib = require('zlib');
var fs = require('fs');
var os = require("os");
const puppeteer = require('puppeteer');

const UserAgent = require('user-agents');
const google = require('./modules/google.js');
const amazon = require('./modules/amazon.js');
const bing = require('./modules/bing.js');
const baidu = require('./modules/baidu.js');
const infospace = require('./modules/infospace.js');
const youtube = require('./modules/youtube.js');
const duckduckgo = require('./modules/duckduckgo.js');
const tickersearch = require('./modules/ticker_search.js');
const common = require('./modules/common.js');
var log = common.log;

const MAX_ALLOWED_BROWSERS = 1;

function write_results(fname, data) {
    fs.writeFileSync(fname, data, (err) => {
        if (err) throw err;
        console.log(`Results written to file ${fname}`);
    });
}

function read_keywords_from_file(fname) {
    let kws =  fs.readFileSync(fname).toString().split(os.EOL);
    // clean keywords
    kws = kws.filter((kw) => {
        return kw.trim().length > 0;
    });
    return kws;
}


function getScraper(search_engine, args) {
    if (typeof search_engine === 'string') {
        return new {
            google: google.GoogleScraper,
            google_news_old: google.GoogleNewsOldScraper,
            google_news: google.GoogleNewsScraper,
            google_image: google.GoogleImageScraper,
            google_maps: google.GoogleMapsScraper,
            google_shopping: google.GoogleShoppingScraper,
            bing: bing.BingScraper,
            bing_news: bing.BingNewsScraper,
            amazon: amazon.AmazonScraper,
            duckduckgo: duckduckgo.DuckduckgoScraper,
            duckduckgo_news: duckduckgo.DuckduckgoNewsScraper,
            infospace: infospace.InfospaceScraper,
            webcrawler: infospace.WebcrawlerNewsScraper,
            baidu: baidu.BaiduScraper,
            youtube: youtube.YoutubeScraper,
            yahoo_news: tickersearch.YahooFinanceScraper,
            reuters: tickersearch.ReutersFinanceScraper,
            cnbc: tickersearch.CnbcFinanceScraper,
            marketwatch: tickersearch.MarketwatchFinanceScraper,
        }[search_engine](args);
    } else if (typeof search_engine === 'function') {
        return new search_engine(args);
    } else {
        throw new Error(`search_engine must either be a string of class (function)`);
    }
}


class ScrapeManager {

    constructor(config, context={}) {

        this.pluggable = null;
        this.scraper = null;
        this.context = context;

        this.config = {
            // the user agent to scrape with
            user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3835.0 Safari/537.36',
            // if random_user_agent is set to True, a random user agent is chosen
            random_user_agent: false,
            // whether to select manual settings in visible mode
            set_manual_settings: false,
            // log ip address data
            log_ip_address: false,
            // log http headers
            log_http_headers: false,
            // how long to sleep between requests. a random sleep interval within the range [a,b]
            // is drawn before every request. empty string for no sleeping.
            sleep_range: undefined,
            // which search engine to scrape
            search_engine: 'google',
            search_engine_name: 'google',
            compress: false, // compress
            // whether debug information should be printed
            // level 0: print nothing
            // level 1: print most important info
            // ...
            // level 4: print all shit nobody wants to know
            debug_level: 1,
            keywords: ['nodejs rocks',],
            // whether to start the browser in headless mode
            headless: true,
            // specify flags passed to chrome here
            chrome_flags: [],
            // the number of pages to scrape for each keyword
            num_pages: 1,
            // path to output file, data will be stored in JSON
            output_file: '',
            // whether to also passthru all the html output of the serp pages
            html_output: false,
            // whether to strip JS and CSS from the html_output
            // has only an effect if `html_output` is true
            clean_html_output: true,
            // remove all data images from the html
            clean_data_images: true,
            // whether to return a screenshot of serp pages as b64 data
            screen_output: false,
            // Scrape url from local file. Mainly used for testing.
            scrape_from_file: '',
            // whether to prevent images, css, fonts and media from being loaded
            // will speed up scraping a great deal
            block_assets: true,
            // block specific requests using regex patterns.
            block_regex: [],
            // path to js module that extends functionality
            // this module should export the functions:
            // get_browser, handle_metadata, close_browser
            //custom_func: resolve('examples/pluggable.js'),
            custom_func: undefined,
            throw_on_detection: false,
            // use a proxy for all connections
            // example: 'socks5://78.94.172.42:1080'
            // example: 'http://118.174.233.10:48400'
            proxy: '',
            // a file with one proxy per line. Example:
            // socks5://78.94.172.42:1080
            // http://118.174.233.10:48400
            proxy_file: '',
            // whether to use proxies only
            // when this is set to true, se-scraper will not use
            // your default IP address
            use_proxies_only: false,
            // check if headless chrome escapes common detection techniques
            // this is a quick test and should be used for debugging
            test_evasion: false,
            apply_evasion_techniques: true,
        };

        this.config.proxies = [];

        // overwrite default config
        for (var key in config) {
            this.config[key] = config[key];
        }

        if (config.sleep_range) {
            // parse an array
            config.sleep_range = eval(config.sleep_range);

            if (config.sleep_range.length !== 2 && typeof i[0] !== 'number' && typeof i[1] !== 'number') {
                throw "sleep_range is not a valid array of two integers.";
            }
        }

        if (fs.existsSync(this.config.keyword_file)) {
            this.config.keywords = read_keywords_from_file(this.config.keyword_file);
        }

        if (fs.existsSync(this.config.proxy_file)) {
            this.config.proxies = read_keywords_from_file(this.config.proxy_file);
            log(this.config, 1, `${this.config.proxies.length} proxies read from file.`);
        }

        log(this.config, 2, this.config);
    }

    /*
     * Launches the puppeteer browser.
     *
     * Returns true if the browser was successfully launched. Otherwise will return false.
     */
    async start() {

        if (this.config.custom_func) {
            if (fs.existsSync(this.config.custom_func)) {
                try {
                    const PluggableClass = require(this.config.custom_func);
                    this.pluggable = new PluggableClass({
                        config: this.config,
                        context: this.context
                    });
                } catch (exception) {
                    console.error(exception);
                    return false;
                }
            } else {
                console.error(`File "${this.config.custom_func}" does not exist!`);
                return false;
            }
        }

        // See here: https://peter.sh/experiments/chromium-command-line-switches/
        var default_chrome_flags = [
            '--disable-infobars',
            '--window-position=0,0',
            '--ignore-certifcate-errors',
            '--ignore-certifcate-errors-spki-list',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1040',
            '--start-fullscreen',
            '--hide-scrollbars',
            '--disable-notifications',
        ];

        var chrome_flags = default_chrome_flags.slice(); // copy that

        if (Array.isArray(this.config.chrome_flags) && this.config.chrome_flags.length) {
            chrome_flags = this.config.chrome_flags;
        }

        var user_agent = null;

        if (this.config.user_agent) {
            user_agent = this.config.user_agent;
        }

        if (this.config.random_user_agent) {
            const userAgent = new UserAgent({ deviceCategory: 'desktop' });
            user_agent = userAgent.toString();
        }

        if (user_agent) {
            chrome_flags.push(
                `--user-agent=${user_agent}`
            )
        }

        if (this.config.proxy) {
            if (this.config.proxies && this.config.proxies.length > 0) {
                console.error('Either use a proxy_file or specify a proxy for all connections. Do not use both options.');
                return false;
            }

            chrome_flags.push(
                '--proxy-server=' + this.config.proxy,
            )
        }

        var launch_args = {
            args: chrome_flags,
            headless: this.config.headless,
            ignoreHTTPSErrors: true,
        };

        log(this.config, 2, `Using the following puppeteer configuration: ${launch_args}`);

        launch_args.config = this.config;
        this.browser = await puppeteer.launch(launch_args);
        this.page = await this.browser.newPage();
    }

    /*
     * Scrapes the keywords specified by the config.
     */
    async scrape(scrape_config = {}) {

        if (!scrape_config.keywords && !scrape_config.keyword_file) {
            console.error('Either keywords or keyword_file must be supplied to scrape()');
            return false;
        }

        Object.assign(this.config, scrape_config);

        var results = {};
        var num_requests = 0;
        var metadata = {};
        var startTime = Date.now();

        this.config.search_engine_name = typeof this.config.search_engine === 'function' ? this.config.search_engine.name : this.config.search_engine;

        if (this.config.keywords && this.config.search_engine) {
            log(this.config, 1,
                `[se-scraper] started at [${(new Date()).toUTCString()}] and scrapes ${this.config.search_engine_name} with ${this.config.keywords.length} keywords on ${this.config.num_pages} pages each.`)
        }

        // do scraping
        this.scraper = getScraper(this.config.search_engine, {
            config: this.config,
            context: this.context,
            pluggable: this.pluggable,
            page: this.page,
        });
        let res = await this.scraper.run({page: this.page});
        results = res.results;
        metadata = this.scraper.metadata;
        num_requests = this.scraper.num_requests;

        // log
        let timeDelta = Date.now() - startTime;
        let ms_per_request = timeDelta/num_requests;

        log(this.config, 1, `Scraper took ${timeDelta}ms to perform ${num_requests} requests.`);
        log(this.config, 1, `On average ms/request: ${ms_per_request}ms/request`);

        if (this.config.compress) {
            log(this.config, 1, 'Compressing results');
            results = JSON.stringify(results);
            // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Encoding
            results = zlib.deflateSync(results).toString('base64');
        }

        if (this.pluggable && this.pluggable.handle_results) {
            await this.pluggable.handle_results(results);
        }

        if (this.config.chunk_lines) {
            metadata.chunk_lines = this.config.chunk_lines;
            if (this.config.job_name) {
                metadata.id = `${this.config.job_name} ${this.config.chunk_lines}`;
            }
        }

        metadata.elapsed_time = timeDelta.toString();
        metadata.ms_per_keyword = ms_per_request.toString();
        metadata.num_requests = num_requests;

        log(this.config, 2, metadata);

        if (this.pluggable && this.pluggable.handle_metadata) {
            await this.pluggable.handle_metadata(metadata);
        }

        if (this.config.output_file) {
            log(this.config, 1, `Writing results to ${this.config.output_file}`);
            write_results(this.config.output_file, JSON.stringify(results, null, 4));
        }

        return {
            results: results,
            metadata: metadata || {},
        };
    }

    /*
     * Quits the puppeteer browser.
     */
    async quit() {
        await this.browser.close();
    }
}

module.exports = {
    ScrapeManager: ScrapeManager,
};
