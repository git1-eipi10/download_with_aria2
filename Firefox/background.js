browser.runtime.onInstalled.addListener(({reason, previousVersion}) => {
    reason === 'update' && previousVersion < '3.7.5' && setTimeout(() => {
        var patch = {
            'jsonrpc_uri': aria2RPC.jsonrpc.uri,
            'secret_token': aria2RPC.jsonrpc.token,
            'refresh_interval': aria2RPC.jsonrpc.refresh,
            'user_agent': aria2RPC.useragent,
            'proxy_server': aria2RPC.proxy.uri,
            'proxy_resolve': aria2RPC.proxy.resolve,
            'capture_mode': aria2RPC.capture.mode,
            'capture_type': aria2RPC.capture.fileExt,
            'capture_size': aria2RPC.capture.fileSize,
            'capture_resolve': aria2RPC.capture.resolve,
            'capture_reject': aria2RPC.capture.reject,
            'folder_mode': aria2RPC.folder.mode,
            'folder_path': aria2RPC.folder.uri
        };
        aria2RPC = patch;
        chrome.storage.local.clear();
        chrome.storage.local.set(aria2RPC);
    }, 300);
});

browser.contextMenus.create({
    title: browser.i18n.getMessage('extension_name'),
    id: 'downwitharia2firefox',
    contexts: ['link']
});

browser.contextMenus.onClicked.addListener(({linkUrl, pageUrl}, {cookieStoreId}) => {
    startDownload({url: linkUrl, referer: pageUrl, storeId: cookieStoreId, domain: getDomainFromUrl(pageUrl)});
});

browser.downloads.onCreated.addListener(async ({id, url, referrer, filename}) => {
    if (aria2RPC['capture_mode'] === '0' || url.startsWith('blob') || url.startsWith('data')) {
        return;
    }

    var tabs = await browser.tabs.query({active: true, currentWindow: true});
    var referer = referrer && referrer !== 'about:blank' ? referrer : tabs[0].url;
    var domain = getDomainFromUrl(referer);
    var storeId = tabs[0].cookieStoreId;

    if (await captureDownload(domain, getFileExtension(filename), url)) {
        browser.downloads.cancel(id).then(() => {
            browser.downloads.erase({id}).then(() => {
                startDownload({url, referer, domain, filename, storeId});
            });
        }).catch(error => showNotification('Download is already complete'));
    }
});

async function startDownload({url, referer, domain, filename, storeId}, options = {}) {
    var cookies = await browser.cookies.getAll({url, storeId});
    options['header'] = ['Cookie:', 'Referer: ' + referer, 'User-Agent: ' + aria2RPC['user_agent']];
    cookies.forEach(({name, value}) => options['header'][0] += ' ' + name + '=' + value + ';');
    filename && (options = {...options, ...await getFirefoxExclusive(filename)});
    options['all-proxy'] = aria2RPC['proxy_resolve'].includes(domain) ? aria2RPC['proxy_server'] : '';
    aria2RPCCall({method: 'aria2.addUri', params: [[url], options]}, result => showNotification(url));
}

async function captureDownload(domain, type, url) {
    if (aria2RPC['capture_reject'].includes(domain)) {
        return false;
    }
    if (aria2RPC['capture_mode'] === '2') {
        return true;
    }
    if (aria2RPC['capture_resolve'].includes(domain)) {
        return true;
    }
    if (aria2RPC['capture_type'].includes(type)) {
        return true;
    }
// Use Fetch to resolve fileSize untill Mozilla fixes downloadItem.fileSize
// Some websites will not support this workaround due to their access policy
// See https://bugzilla.mozilla.org/show_bug.cgi?id=1666137 for more details
    if (aria2RPC['capture_size'] > 0 && await fetch(url, {method: 'HEAD'}).then(response => response.headers.get('content-length')) >= aria2RPC['capture_size']) {
        return true;
    }
    return false;
}

function getDomainFromUrl(url) {
    var host = /^[^:]+:\/\/([^\/]+)\//.exec(url)[1];
    var hostname = /:\d{2,5}$/.test(host) ? host.slice(0, host.lastIndexOf(':')) : host;
    if (hostname.includes(':')) {
        return hostname.slice(1, -1);
    }
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$|^[^\.]+\.[^\.]+$/.test(hostname)) {
        return hostname;
    }
    var suffix = /([^\.]+)\.([^\.]+)\.([^\.]+)$/.exec(hostname);
    var gSLD = ['com', 'net', 'org', 'edu', 'gov', 'co', 'ne', 'or', 'me'];
    return gSLD.includes(suffix[2]) ? suffix[1] + '.' + suffix[2] + '.' + suffix[3] : suffix[2] + '.' + suffix[3];
}

async function getFirefoxExclusive(uri) {
    var platform = await browser.runtime.getPlatformInfo();
    var index = platform.os === 'win' ? uri.lastIndexOf('\\') : uri.lastIndexOf('/');
    var out = uri.slice(index + 1);
    var dir = aria2RPC['folder_mode'] === '1' ? uri.slice(0, index + 1) : aria2RPC.folder['mode'] === '2' ? aria2RPC['folder_path'] : null;
    if (dir) {
        return {dir, out};
    }
    return {out};
}

function getFileExtension(filename) {
    return filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
}

function aria2RPCClient() {
    aria2RPCCall({method: 'aria2.getGlobalStat'}, ({numActive}) => {
        browser.browserAction.setBadgeBackgroundColor({color: '#3cc'});
        browser.browserAction.setBadgeText({text: numActive === '0' ? '' : numActive});
    }, error => {
        browser.browserAction.setBadgeBackgroundColor({color: '#c33'});
        browser.browserAction.setBadgeText({text: 'E'});
    }, true);
}
