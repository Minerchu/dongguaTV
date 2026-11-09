'use strict';

const QUALITY_WORDS = /(?:4k|8k|2160p|1080p|720p|480p|web[- ]?dl|webrip|bluray|blu-ray|hdtv|remux|hdr|dolby|杜比|蓝光|高清|超清|国语|粤语|中字|中文字幕|双语|完整版|未删减|导演剪辑版|抢先版|枪版|tc|ts)/gi;

function cleanName(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function extractYear(item) {
    const direct = cleanName(item && (item.vod_year || item.vod_pubdate || item.vod_release));
    const directMatch = direct.match(/(?:19|20)\d{2}/);
    if (directMatch) return directMatch[0];
    const name = cleanName(item && item.vod_name);
    const bracket = name.match(/[\[\(（【〔]\s*((?:19|20)\d{2})\s*[\]\)）】〕]/);
    if (bracket) return bracket[1];
    const tail = name.match(/(?:^|[^\d])((?:19|20)\d{2})\s*$/);
    if (tail && name.replace(/[^\d]/g, '') !== tail[1]) return tail[1];
    return '';
}

function normalizeTitle(value) {
    let text = String(value == null ? '' : value).normalize('NFKC').toLowerCase();
    text = text.replace(/[\[\(（【〔][^\]\)）】〕]*[\]\)）】〕]/g, ' ');
    text = text.replace(/第[一二三四五六七八九十百0-9]+[季部期]/g, ' ');
    text = text.replace(/season\s*\d+/gi, ' ');
    text = text.replace(/\bs\d{1,2}\b/gi, ' ');
    text = text.replace(QUALITY_WORDS, ' ');
    return text.replace(/[^\p{L}\p{N}]+/gu, '');
}

function usablePicture(value) {
    const pic = cleanName(value);
    if (!/^https?:\/\//i.test(pic)) return false;
    return !/(?:mac_default|nopic|no-pic|no_pic|default\.(?:jpg|png))/i.test(pic);
}

function sourceIdentity(item) {
    const site = cleanName(item && item.site_key);
    const id = cleanName(item && item.vod_id);
    if (site && id) return site + ':' + id;
    const play = cleanName(item && (item.vod_play_url || item.vod_pic));
    return site + ':' + (play || cleanName(item && item.vod_name));
}

function compareSources(left, right) {
    const leftLatency = Number(left && left.latency);
    const rightLatency = Number(right && right.latency);
    const a = Number.isFinite(leftLatency) && leftLatency > 0 ? leftLatency : 9999;
    const b = Number.isFinite(rightLatency) && rightLatency > 0 ? rightLatency : 9999;
    if (a !== b) return a - b;
    return String(left && left.site_name || '').localeCompare(String(right && right.site_name || ''), 'zh-CN');
}

function groupSearchResults(list) {
    const groups = new Map();
    const seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
        if (!raw || typeof raw !== 'object') continue;
        const identity = sourceIdentity(raw);
        if (seen.has(identity)) continue;
        seen.add(identity);
        const name = cleanName(raw.vod_name) || '未命名';
        const title = normalizeTitle(name);
        const year = extractYear(raw);
        const key = (title || cleanName(name).toLowerCase()) + '|' + year;
        let group = groups.get(key);
        if (!group) {
            group = { key, name, year, pic: '', sources: [], title };
            groups.set(key, group);
        }
        if (usablePicture(raw.vod_pic) && (!group.pic || group.pic.includes('mac_default'))) group.pic = cleanName(raw.vod_pic);
        group.sources.push(raw);
    }

    const byTitle = new Map();
    for (const group of groups.values()) {
        if (!byTitle.has(group.title)) byTitle.set(group.title, []);
        byTitle.get(group.title).push(group);
    }
    for (const items of byTitle.values()) {
        const dated = items.filter(item => item.year);
        const undated = items.find(item => !item.year);
        if (undated && dated.length === 1) {
            const target = dated[0];
            target.sources.push(...undated.sources);
            if (!target.pic && undated.pic) target.pic = undated.pic;
            groups.delete(undated.key);
        }
    }

    return Array.from(groups.values()).map(group => {
        const bySite = new Map();
        group.sources.sort(compareSources);
        for (const source of group.sources) {
            const site = cleanName(source.site_key) || 'unknown';
            if (!bySite.has(site)) bySite.set(site, source);
        }
        return {
            key: group.key,
            name: group.name,
            year: group.year,
            pic: group.pic || group.sources.map(item => item.vod_pic).find(usablePicture) || '',
            siteCount: bySite.size,
            sourceCount: group.sources.length,
            sources: group.sources
        };
    }).sort((left, right) => {
        if (right.sourceCount !== left.sourceCount) return right.sourceCount - left.sourceCount;
        const yearDiff = (Number(right.year) || 0) - (Number(left.year) || 0);
        if (yearDiff) return yearDiff;
        return left.name.localeCompare(right.name, 'zh-CN');
    });
}

module.exports = { normalizeTitle, extractYear, groupSearchResults };
