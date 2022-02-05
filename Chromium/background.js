var disabled = false;
var download_info = new Object()
download_info = {};

chrome.contextMenus.create({
    title: chrome.runtime.getManifest().name,
    id: 'downwitharia2',
    contexts: ['link']
});

chrome.contextMenus.onClicked.addListener(({linkUrl, pageUrl}) => {
    startDownload(linkUrl, pageUrl, getDomainFromUrl(pageUrl));
});

chrome.storage.local.get(null, async json => {
    aria2Store = json['jsonrpc_uri'] ? json : await fetch('/options.json').then(response => response.json());
    statusIndicator();
    !json['jsonrpc_uri'] && chrome.storage.local.set(aria2Store);
});

chrome.downloads.onDeterminingFilename.addListener(({id, finalUrl, referrer, filename, fileSize}) => {
    if (fileSize) { download_info.fileSize = fileSize; }
    if (aria2Store['capture_mode'] === '0' || finalUrl.startsWith('blob') || finalUrl.startsWith('data')) {
        disabled = true;
        download_info = {};
        return;
    }
    chrome.tabs.query({active: true, currentWindow: true}, ([tab]) => {
        download_info.url = finalUrl;
        download_info.referer = referrer ? referrer : tab.url ?? 'about:blank';
        download_info.domain = getDomainFromUrl(download_info.referer);
        download_info.filename = filename;
    });
});

chrome.downloads.onChanged.addListener(item => {
    if (disabled === true){
        disabled = false;
        download_info = {};
        return;
    }
    if (item.fileSize) { download_info.fileSize = item.fileSize.current; }
    Object.entries(item).forEach(([key, {newValue}]) => aria2Store[key] = newValue);
    if (item.filename) {
        download_info.path = item.filename.current;

        captureDownload(download_info.domain, getFileExtension(download_info.filename), download_info.fileSize) &&
            chrome.downloads.cancel(item.id, () => {
                console.log(download_info);
                var options = {
                    'out': download_info.filename,
                    'dir': download_info.path.slice(0, download_info.path.indexOf(download_info.filename))
                };
                chrome.downloads.erase({id: item.id}, () => {
                    startDownload(download_info.url, download_info.referer, download_info.domain, options);
                    disabled = false;
                    download_info = {};
                });
            });
    }
    if (item['jsonrpc_uri'] || item['secret_token']) {
        self.jsonrpc && jsonrpc.readyState === 1 && jsonrpc.close();
        statusIndicator();
    }
});

async function statusIndicator() {
    jsonrpc = await aria2RPCStatus(text => {
        chrome.browserAction.setBadgeText({text: text === '0' ? '' : text});
        chrome.browserAction.setBadgeBackgroundColor({color: text ? '#3cc' : '#c33'});
    });
}

function startDownload(url, referer, domain, options = {}) {
    chrome.cookies.getAll({url}, cookies => {
        options['header'] = ['Cookie:', 'Referer: ' + referer, 'User-Agent: ' + aria2Store['user_agent']];
        cookies.forEach(({name, value}) => options['header'][0] += ' ' + name + '=' + value + ';');
        options['all-proxy'] = aria2Store['proxy_include'].includes(domain) ? aria2Store['proxy_server'] : '';
        aria2RPCCall({method: 'aria2.addUri', params: [[url], options]}, result => showNotification(url));
    });
}

function captureDownload(domain, type, size) {
    return aria2Store['capture_exclude'].includes(domain) ? false :
        aria2Store['capture_reject'].includes(type) ? false :
        aria2Store['capture_mode'] === '1' ? true : aria2Store['capture_mode'] === '2' ? true :
        aria2Store['capture_include'].includes(domain) ? true :
        aria2Store['capture_resolve'].includes(type) ? true :
        aria2Store['capture_size'] > 0 && size >= aria2Store['capture_size'] ? true : false;
}
