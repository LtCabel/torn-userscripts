// ==UserScript==
// @name         Torn: Racing enhancements (Compatible with Torn PDA)
// @namespace    ltcabel.racing_enhancements
// @version      0.6.5
// @description  Show car's current speed, precise skill, official race penalty, racing skill of others and race car skins.
// @author       Lugburz, modified by Reshula & LtCabel
// @match        https://www.torn.com/loader.php?sid=racing*
// @match        https://www.torn.com/page.php?sid=racing*
// @updateURL    https://raw.githubusercontent.com/LtCabel/torn-userscripts/master/racing_enhancements_pda_compatible.user.js
// @downloadURL  https://raw.githubusercontent.com/LtCabel/torn-userscripts/master/racing_enhancements_pda_compatible.user.js
// @connect      api.torn.com
// @connect      race-skins.brainslug.nl
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

console.log("[Racing Enhancements PDA] starting");

// -------------------- Toggles / settings --------------------
const NOTIFICATIONS = GM_getValue('showNotifChk') != 0;
const SHOW_RESULTS = GM_getValue('showResultsChk') != 0;
const SHOW_SPEED = GM_getValue('showSpeedChk') != 0;
const SHOW_POSITION_ICONS = GM_getValue('showPositionIconChk') != 0;
let   FETCH_RS = !!(GM_getValue('apiKey') && GM_getValue('apiKey').length > 0);
const SHOW_SKINS = GM_getValue('showSkinsChk') != 0;
const RACE_ROW_LAYOUT = 'stacked';

// -------------------- Skins config --------------------
const SKIN_AWARDS = 'https://race-skins.brainslug.nl/custom/data';
const SKIN_IMAGE  = id => `https://race-skins.brainslug.nl/assets/${id}`;

const userID = getUserIdFromCookie();
let   RACE_ID = '*';
const period = 1000;
let   last_compl = -1.0;
let   x = 0;
let   penaltyNotif = 0;

// -------------------- Helpers --------------------
function maybeClear() {
    if (x != 0 ) {
        clearInterval(x);
        last_compl = -1.0;
        x = 0;
    }
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// -------------------- Racing Skill cache --------------------
const racingSkillCacheByDriverId = new Map();
let updating = false;

async function updateDriversList() {
    const driversList = document.getElementById('leaderBoard');
    if (updating || driversList === null) return;

    FETCH_RS = !!(GM_getValue('apiKey') && GM_getValue('apiKey').length > 0);

    watchForDriversListContentChanges(driversList);

    const driverIds = getDriverIds(driversList);
    if (!driverIds || !driverIds.length) return;

    updating = true;
    $('#updating').size() < 1 && $('#racingupdatesnew').prepend('<div id="updating" style="color: green; font-size: 12px; line-height: 24px;">Updating drivers\' RS and skins...</div>');

    const racingSkills = FETCH_RS ? await getRacingSkillForDrivers(driverIds) : {};
    const racingSkins  = SHOW_SKINS ? await getRacingSkinOwners(driverIds)  : {};
    for (let driver of driversList.querySelectorAll('.driver-item')) {
        const driverId = getDriverId(driver);

        // RS badge
        if (FETCH_RS && !!racingSkills[driverId]) {
            const skill   = racingSkills[driverId];
            const nameDiv = driver.querySelector('.name');
            nameDiv.style.position = 'relative';
            if (!driver.querySelector('.rs-display')) {
                nameDiv.insertAdjacentHTML('beforeend', `<span class="rs-display">RS:${skill}</span>`);
            }
        } else if (!FETCH_RS) {
            const rsSpan = driver.querySelector('.rs-display');
            if (!!rsSpan) rsSpan.remove();
        }

        // Skin
        if (SHOW_SKINS && !!racingSkins[driverId]) {
            const carImg = driver.querySelector('.car')?.querySelector('img');
            if (carImg) {
                const carId = carImg.getAttribute('src').replace(/[^0-9]*/g, '');
                if (!!racingSkins[driverId][carId]) {
                    carImg.setAttribute('src', SKIN_IMAGE(racingSkins[driverId][carId]));
                    if (driverId == userID) skinCarSidebar(racingSkins[driverId][carId]);
                }
            }
        }
    }

    updating = false;
    $('#updating').size() > 0 && $('#updating').remove();
}

function watchForDriversListContentChanges(driversList) {
    if (driversList.dataset.hasWatcher !== undefined) return;
    new MutationObserver(updateDriversList).observe(driversList, {childList: true});
    driversList.dataset.hasWatcher = 'true';
}

function getDriverIds(driversList) {
    return Array.from(driversList.querySelectorAll('.driver-item')).map(driver => getDriverId(driver));
}
function getDriverId(driverUl) {
    return +driverUl.closest('li').id.substr(4);
}

let racersCount = 0;
async function getRacingSkillForDrivers(driverIds) {
    const driverIdsToFetch = driverIds.filter(driverId => !racingSkillCacheByDriverId.has(driverId));

    for (const driverId of driverIdsToFetch) {
        const json = await fetchRacingSkillForDrivers(driverId);
        racingSkillCacheByDriverId.set(+driverId,
            json && json.personalstats && json.personalstats.racingskill ? json.personalstats.racingskill : 'N/A'
        );
        if (json && json.error) {
            $('#racingupdatesnew').prepend(`<div style="color: red; font-size: 12px; line-height: 24px;">API error: ${JSON.stringify(json.error)}</div>`);
            break;
        }
        racersCount++;
        if (racersCount > 20) await sleep(1500);
    }

    const resultHash = {};
    for (const driverId of driverIds) {
        const skill = racingSkillCacheByDriverId.get(driverId);
        if (!!skill) resultHash[driverId] = skill;
    }
    return resultHash;
}

let _skinOwnerCache = null;
async function getRacingSkinOwners(driverIds) {
    function filterSkins(skins) {
        let result = {};
        for (const driverId of driverIds) {
            if (skins?.['*']?.[driverId]) result[driverId] = skins['*'][driverId];
            if (skins?.[RACE_ID]?.[driverId]) result[driverId] = skins[RACE_ID][driverId];
        }
        return result;
    }
    return new Promise(resolve => {
        if (!!_skinOwnerCache) return resolve(_skinOwnerCache);
        GM_xmlhttpRequest({
            method: 'GET',
            url: SKIN_AWARDS,
            headers: {'Content-Type': 'application/json'},
            onload: ({responseText}) => {
                _skinOwnerCache = JSON.parse(responseText);
                resolve(_skinOwnerCache);
            },
            onerror: (err) => { console.error(err); resolve({}); },
        });
    }).then(filterSkins);
}

let _skinned = false;
function skinCarSidebar(carSkin) {
    const carSelected = document.querySelector('.car-selected');
    if (!carSelected) return;
    const tornItem = carSelected.querySelector('.torn-item');
    if (!tornItem) return;
    if (tornItem !== _skinned) {
        try {
            tornItem.setAttribute('src', SKIN_IMAGE(carSkin));
            tornItem.setAttribute('srcset', SKIN_IMAGE(carSkin));
            tornItem.style.display = 'block';
            tornItem.style.opacity  = 1;
            const canvas = carSelected.querySelector('canvas');
            if (!!canvas) canvas.style.display = 'none';
            _skinned = tornItem;
        } catch (err) { console.error(err); }
    }
}

// -------------------- Utility --------------------
function getUserIdFromCookie() {
    const userIdString = document.cookie.split(';')
        .map(entry => entry.trim())
        .find(entry => entry.indexOf('uid=') === 0)
        ?.replace('uid=', '') || '0';
    return parseInt(userIdString, 10);
}
function pad(num, size) { return ('000000000' + num).substr(-size); }
function formatTime(date) {
    return pad(date.getUTCHours(), 2) + ':' + pad(date.getUTCMinutes(), 2) + ':' + pad(date.getUTCSeconds(), 2);
}
function formatTimeMsec(msec, alwaysShowHours = false) {
    const hours    = Math.floor((msec % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes  = Math.floor((msec % (1000 * 60 * 60)) / (1000 * 60));
    const seconds  = Math.floor((msec % (1000 * 60)) / 1000);
    const mseconds = Math.floor(msec % 1000);
    return (alwaysShowHours ? pad(hours, 2) + ":" : (hours > 0 ? hours + ":" : ''))
        + (hours > 0 || minutes > 0 ? pad(minutes, 2) + ":" : '')
        + pad(seconds, 2) + "." + pad(mseconds, 3);
}
function formatTimeSecWithLetters(msec) {
    const hours   = Math.floor((msec % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((msec % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((msec % (1000 * 60)) / 1000);
    return (hours > 0 ? hours + "h " : '') + (hours > 0 || minutes > 0 ? minutes + "min " : '') + seconds + "s";
}
function decode64(input) {
    var output = '';
    var chr1, chr2, chr3 = '';
    var enc1, enc2, enc3, enc4 = '';
    var i = 0;
    var keyStr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    var base64test = /[^A-Za-z0-9\+\/\=]/g;
    if (base64test.exec(input)) {
        console.log('Invalid base64 characters detected. Expect possible decode issues.');
    }
    input = input.replace(/[^A-Za-z0-9\+\/\=]/g, '');
    do {
        enc1 = keyStr.indexOf(input.charAt(i++));
        enc2 = keyStr.indexOf(input.charAt(i++));
        enc3 = keyStr.indexOf(input.charAt(i++));
        enc4 = keyStr.indexOf(input.charAt(i++));
        chr1 = (enc1 << 2) | (enc2 >> 4);
        chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
        chr3 = ((enc3 & 3) << 6) | enc4;
        output = output + String.fromCharCode(chr1);
        if (enc3 != 64) output = output + String.fromCharCode(chr2);
        if (enc4 != 64) output = output + String.fromCharCode(chr3);
        chr1 = chr2 = chr3 = '';
        enc1 = enc2 = enc3 = enc4 = '';
    } while (i < input.length);
    return unescape(output);
}

// -------------------- API --------------------
function fetchRacingSkillForDrivers(driverIds) {
    const apiKey = GM_getValue('apiKey');
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: 'POST',
            url: `https://api.torn.com/user/${driverIds}?selections=personalstats&comment=RacingUiUx&key=${apiKey}`,
            headers: { 'Content-Type': 'application/json' },
            onload: (response) => {
                try { resolve(JSON.parse(response.responseText)); }
                catch(err) { reject(err); }
            },
            onerror: (err) => { reject(err); }
        });
    });
}

// -------------------- UI bits --------------------
function showSpeed() {
    if (!SHOW_SPEED || $('#racingdetails').size() < 1 || $('#racingdetails').find('#speed_mph').size() > 0) return;

    $('#racingdetails').find('li.pd-name').each(function() {
        if ($(this).text() == 'Name:') $(this).hide();
        if ($(this).text() == 'Position:') $(this).text('Pos:');
        if ($(this).text() == 'Completion:') $(this).text('Compl:');
    });
    $('#racingdetails').append('<li id="speed_mph" class="pd-val"></li>');

    maybeClear();
    x = setInterval(function() {
        if ($('#racingupdatesnew').find('div.track-info').size() < 1) {
            maybeClear();
            return;
        }
        let laps  = $('#racingupdatesnew').find('div.title-black').text().split(" - ")[1].split(" ")[0];
        let len   = $('#racingupdatesnew').find('div.track-info').attr('data-length').replace('mi', '');
        let compl = $('#racingdetails').find('li.pd-completion').text().replace('%', '');

        if (last_compl >= 0) {
            let speed = (compl - last_compl) / 100 * laps * len * 60 * 60 * 1000 / period;
            $('#speed_mph').text(speed.toFixed(2) + 'mph');
        }
        last_compl = compl;
    }, period);
}

function showPenalty() {
    if ($('#racingAdditionalContainer').find('div.msg.right-round').size() > 0 &&
        $('#racingAdditionalContainer').find('div.msg.right-round').text().trim().startsWith('You have recently left')) {
        const penalty = GM_getValue('leavepenalty') * 1000;
        const now = Date.now();
        if (penalty > now) {
            const date = new Date(penalty);
            $('#racingAdditionalContainer').find('div.msg.right-round').text('You may join an official race at ' + formatTime(date) + '.');
        }
    }
}

function checkPenalty() {
    if (penaltyNotif) clearTimeout(penaltyNotif);
    const leavepenalty = GM_getValue('leavepenalty');
    const penaltyLeft = leavepenalty * 1000 - Date.now();
    if (NOTIFICATIONS && penaltyLeft > 0) {
        penaltyNotif = setTimeout(function() {
            GM_notification("You may join an official race now.", "Torn: Racing enhancements");
        }, penaltyLeft);
    }
}

function updateSkill(level) {
    const skill = Number(level).toFixed(5);
    const prev  = GM_getValue('racinglevel');

    const now = Date.now();
    const lastDaysRs = GM_getValue('lastDaysRs');
    if (lastDaysRs && lastDaysRs.includes(':')) {
        const ts = lastDaysRs.split(':')[0];
        const dateTs = new Date(); dateTs.setTime(ts);
        if ((new Date(now).setUTCHours(0,0,0,0)) - (dateTs.setUTCHours(0,0,0,0)) >= 24*60*60*1000) {
            GM_setValue('lastDaysRs', `${now}:${prev ? prev : skill}`);
        }
    } else {
        GM_setValue('lastDaysRs', `${now}:${prev ? prev : skill}`);
    }

    if (prev !== "undefined" && typeof prev !== "undefined" && level > prev) {
        const inc = Number(level - prev).toFixed(5);
        if (NOTIFICATIONS) GM_notification("Your racing skill has increased by " + inc + "!", "Torn: Racing enhancements");
        GM_setValue('lastRSincrement', inc);
    }
    GM_setValue('racinglevel', level);

    if ($('#racingMainContainer').find('div.skill').size() > 0) {
        if ($("#sidebarroot").find("a[class^='menu-value']").size() > 0) {
            $('#racingMainContainer').find('div.skill-desc').css('left', '5px');
            $('#racingMainContainer').find('div.skill').css('left', '5px').text(skill);
        } else {
            $('#racingMainContainer').find('div.skill').text(skill);
        }

        const lastInc = GM_getValue('lastRSincrement');
        if (lastInc) $('div.skill').append(`<div style="margin-top: 10px;">Last gain: ${lastInc}</div>`);
    }
}

function updatePoints(pointsearned) {
    const now = Date.now();
    const lastDaysPoints = GM_getValue('lastDaysPoints');
    const prev = GM_getValue('pointsearned');
    if (lastDaysPoints && lastDaysPoints.includes(':')) {
        const ts = lastDaysPoints.split(':')[0];
        const dateTs = new Date(); dateTs.setTime(ts);
        if ((new Date(now).setUTCHours(0,0,0,0)) - (dateTs.setUTCHours(0,0,0,0)) >= 24*60*60*1000) {
            GM_setValue('lastDaysPoints', `${now}:${prev ? prev : pointsearned}`);
        }
    } else {
        GM_setValue('lastDaysPoints', `${now}:${prev ? prev : pointsearned}`);
    }
    GM_setValue('pointsearned', pointsearned);
}

// -------------------- Results --------------------
function parseRacingData(data) {
    // no sidebar in phone mode
    const my_name = $("#sidebarroot").find("a[class^='menu-value']").html() || data.user.playername;

    updateSkill(data.user.racinglevel);
    updatePoints(data.user.pointsearned);

    const leavepenalty = data.user.leavepenalty;
    GM_setValue('leavepenalty', leavepenalty);
    checkPenalty();

    // race link
    if ($('#raceLink').size() < 1) {
        RACE_ID = data.raceID;
        const raceLink = `<a id="raceLink" href="https://www.torn.com/loader.php?sid=racing&tab=log&raceID=${RACE_ID}" style="float: right; margin-left: 12px;">Link to the race</a>`;
        $(raceLink).insertAfter('#racingEnhSettings');
    }

    // results when race finished
    if (data.timeData.status >= 3) {
        const carsData       = data.raceData.cars;
        const carInfo        = data.raceData.carInfo;
        const trackIntervals = data.raceData.trackData.intervals.length;

        let results = [], crashes = [];

        for (const playername in carsData) {
            const userId    = carInfo[playername].userID;
            const intervals = decode64(carsData[playername]).split(',');
            let raceTime = 0;
            let bestLap  = 9999999999;

            if (intervals.length / trackIntervals == data.laps) {
                for (let i = 0; i < data.laps; i++) {
                    let lapTime = 0;
                    for (let j = 0; j < trackIntervals; j++) {
                        lapTime += Number(intervals[i * trackIntervals + j]);
                    }
                    bestLap  = Math.min(bestLap, lapTime);
                    raceTime += Number(lapTime);
                }
                results.push([playername, userId, raceTime, bestLap]);
            } else {
                crashes.push([playername, userId, 'crashed']);
            }
        }

        results.sort(compare);
        addExportButton(results, crashes, my_name, data.raceID, data.timeData.timeEnded);

        if (SHOW_RESULTS) {
            showResults(results);
            showResults(crashes, results.length);
        }
    }
}

function compare(a, b) {
    if (a[2] > b[2]) return 1;
    if (b[2] > a[2]) return -1;
    return 0;
}

function showResults(results, start = 0) {
  for (let i = 0; i < results.length; i++) {
    $('#leaderBoard').children('li').each(function () {
      const nameLi = $(this).find('li.name');
      const nameText = nameLi.clone().children().remove().end().text().trim(); // text without child spans
      if (nameText === results[i][0]) {
        const p = i + start + 1;
        const position = p === 1 ? 'gold' : (p === 2 ? 'silver' : (p === 3 ? 'bronze' : ''));
        let place;
        if (p != 11 && (p % 10) == 1) place = p + 'st';
        else if (p != 12 && (p % 10) == 2) place = p + 'nd';
        else if (p != 13 && (p % 10) == 3) place = p + 'rd';
        else place = p + 'th';

        const result = typeof results[i][2] === 'number'
          ? formatTimeMsec(results[i][2] * 1000)
          : results[i][2];
        const bestLap = results[i][3] ? formatTimeMsec(results[i][3] * 1000) : null;

        // keep any existing RS badge that was added elsewhere
        const rsBadge = nameLi.find('.rs-display').prop('outerHTML') || '';

        const iconHtml = (SHOW_POSITION_ICONS && position)
          ? `<i class="race_position ${position}"></i>` : '';
        const titleHtml = `${iconHtml}<span class="race-name">${results[i][0]}</span> <span class="race-place">${place}</span>`;

        // build extras depending on layout
        let extraHtml = '';
        if (RACE_ROW_LAYOUT === 'stacked') {
          extraHtml += `<span class="race-extra result">${result}</span>`;
          if (bestLap) extraHtml += `<span class="race-extra best">(best: ${bestLap})</span>`;
        } else { // inline
          const extraBits = [result];
          if (bestLap) extraBits.push(`best: ${bestLap}`);
          extraHtml += `<span class="race-extra">• ${extraBits.join(' • ')}</span>`;
        }

        // apply layout flag for CSS and rebuild contents
        nameLi.attr('data-layout', RACE_ROW_LAYOUT).html(titleHtml + extraHtml + rsBadge);
        nameLi.addClass('racing_name_area');
        return false; // break .each loop
      }
    });
  }
}

function addSettingsDiv() {
    if ($("#racingupdatesnew").size() > 0 && $('#racingEnhSettings').size() < 1) {
        const div = '<div style="font-size: 12px; line-height: 24px; padding-left: 10px; padding-right: 10px; background: repeating-linear-gradient(90deg,#242424,#242424 2px,#2e2e2e 0,#2e2e2e 4px); border-radius: 5px;">' +
              '<a id="racingEnhSettings" style="text-align: right; cursor: pointer;">Settings</a>' +
              '<div id="racingEnhSettingsContainer" style="display: none;"><ul style="color: #ddd;">' +
              '<li><input type="checkbox" style="margin-left: 5px; margin-right: 5px" id="showSpeedChk"><label>Show current speed</label></li>' +
              '<li><input type="checkbox" style="margin-left: 5px; margin-right: 5px" id="showNotifChk"><label>Show notifications</label></li>' +
              '<li><input type="checkbox" style="margin-left: 5px; margin-right: 5px" id="showResultsChk"><label>Show results</label></li>' +
              '<li><input type="checkbox" style="margin-left: 5px; margin-right: 5px" id="showSkinsChk"><label>Show racing skins</label></li>' +
              '<li><input type="checkbox" style="margin-left: 5px; margin-right: 5px" id="showPositionIconChk"><label>Show position icons</label></li>' +
              '<li><label>Fetch racing skill from the API (<a href="https://www.torn.com/preferences.php#tab=api">link to your API key</a>)</label><span class="input-wrap" style="margin: 0px 5px 5px;">' +
              '<input type="text" autocomplete="off" data-lpignore="true" id="apiKey"></span>' +
              '<a href="#" id="saveApiKey" class="link btn-action-tab tt-modified"><i style="display: inline-block; background: url(/images/v2/racing/car_enlist.png) 0 0 no-repeat; vertical-align: middle; height: 15px; width: 15px;"></i>Save</a></li></ul></div></div>';
        $('#racingupdatesnew').prepend(div);

        $('#racingEnhSettingsContainer').find('input[type=checkbox]').each(function() {
            $(this).prop('checked', GM_getValue($(this).attr('id')) != 0);
        });
        $('#apiKey').val(GM_getValue('apiKey'));

        $('#racingEnhSettings').on('click', () => $('#racingEnhSettingsContainer').toggle());
        $('#racingEnhSettingsContainer').on('click', 'input', function() {
            const id = $(this).attr('id');
            const checked = $(this).prop('checked');
            GM_setValue(id, checked ? 1 : 0);
        });
        $('#saveApiKey').click(event => {
            event.preventDefault();
            event.stopPropagation();
            GM_setValue('apiKey', $('#apiKey').val());
            updateDriversList();
        });
    }
}

function addExportButton(results, crashes, my_name, race_id, time_ended) {
    if ($("#racingupdatesnew").size() > 0 && $('#downloadAsCsv').size() < 1) {
        let csv = 'position,name,id,time,best_lap,rs\n';
        for (let i = 0; i < results.length; i++) {
            const timeStr = formatTimeMsec(results[i][2] * 1000, true);
            const bestLap = formatTimeMsec(results[i][3] * 1000);
            csv += [i+1, results[i][0], results[i][1], timeStr, bestLap, (results[i][0] === my_name ? GM_getValue('racinglevel') : '')].join(',') + '\n';
        }
        for (let i = 0; i < crashes.length; i++) {
            csv += [results.length + i + 1, crashes[i][0], crashes[i][1], crashes[i][2], '', (results[i][0] === my_name ? GM_getValue('racinglevel') : '')].join(',') + '\n';
        }

        const timeE = new Date(); timeE.setTime(time_ended * 1000);
        const fileName = `${timeE.getUTCFullYear()}${pad(timeE.getUTCMonth() + 1, 2)}${pad(timeE.getUTCDate(), 2)}-race_${race_id}.csv`;

        const myblob = new Blob([csv], {type: 'application/octet-stream'});
        const myurl  = window.URL.createObjectURL(myblob);
        const exportBtn = `<a id="downloadAsCsv" href="${myurl}" style="float: right; margin-left: 12px;" download="${fileName}">Download results as CSV</a>`;
        $(exportBtn).insertAfter('#racingEnhSettings');
    }
}

function addPlaybackButton() {
    if ($("#racingupdatesnew").size() > 0 && $('div.race-player-container').size() < 1) {
        $('div.drivers-list > div.cont-black').prepend(
`<div class="race-player-container">
<button id="play-pause-btn" class="play"></button>
<div id="speed-slider"><span id="prev-speed" class="disabled"></span><span id="speed-value">x1</span><span id="next-speed" class="enabled"></span></div>
<div id="replay-bar-container"><span id="progress-active"></span><span id="progress-inactive"></span></div>
<div id="race-timer-container"><span id="race-timer">00:00:00</span></div>
</div>`);
    }
}

function displayDailyGains() {
    $('#mainContainer').find('div.content').find('span.label').each((i, el) => {
        if ($(el).text().includes('Racing')) {
            const racingLi = $(el).parent().parent();

            // RS gain
            const desc = $(racingLi).find('span.desc');
            if ($(desc).size() > 0) {
                const rsText    = $(desc).text();
                const currentRs = GM_getValue('racinglevel');
                const lastDaysRs = GM_getValue('lastDaysRs');
                const oldRs = lastDaysRs && lastDaysRs.includes(':') ? lastDaysRs.split(':')[1] : undefined;
                $(desc).text(`${rsText} / Daily gain: ${currentRs && oldRs ? (1*currentRs - 1*oldRs).toFixed(5) : 'N/A'}`);
                $(desc).attr('title', 'Daily gain: How much your racing skill has increased since yesterday.');
            }

            // points gain
            const lastDaysPoints = GM_getValue('lastDaysPoints');
            const currentPoints  = GM_getValue('pointsearned');
            const oldPoints = lastDaysPoints && lastDaysPoints.includes(':') ? lastDaysPoints.split(':')[1] : undefined;
            let pointsTitle = 'Racing points earned: How many points you have earned throughout your career.';
            for (const x of [ {points: 25, class: 'D'}, {points: 100, class: 'C'}, {points: 250, class: 'B'}, {points: 475, class: 'A'} ]) {
                if (currentPoints && currentPoints < x.points) pointsTitle += `<br>Till <b>class ${x.class}</b>: ${1*x.points - 1*currentPoints}`;
            }
            const pointsLi = `<li role="row"><span class="divider"><span class="label" title="${pointsTitle}">Racing points earned</span></span>
<span class="desc" title="Daily gain: How many racing points you've earned since yesterday.">
${currentPoints ? currentPoints : 'N/A'} / Daily gain: ${currentPoints && oldPoints ? 1*currentPoints - 1*oldPoints : 'N/A'}
</span>
</li>`;
            $(pointsLi).insertAfter(racingLi);
            return false;
        }
    });
}

// -------------------- PDA-safe ajax hook (with retry) --------------------
function ajax(callback) {
    try {
        $(document).ajaxComplete((event, xhr, settings) => {
            if (xhr.readyState > 3 && xhr.status == 200) {
                let url = settings.url;
                if (url.indexOf("torn.com/") < 0) url = "torn.com" + (url.startsWith("/") ? "" : "/") + url;
                const page = url.substring(url.indexOf("torn.com/") + "torn.com/".length, url.indexOf(".php"));
                callback(page, xhr, settings);
            }
        });
    } catch (e) {
        // keep trying until jQuery is ready in PDA
        if (e instanceof ReferenceError) {
            setTimeout(ajax, 250, callback);
        } else {
            console.warn('[Racing Enhancements PDA] ajax hook error', e);
        }
    }
}

// -------------------- Main wiring --------------------
'use strict';

ajax((page, xhr) => {
    if (page != "loader" && page != "page") return;

    $("#racingupdatesnew").ready(addSettingsDiv);
    $("#racingupdatesnew").ready(showSpeed);
    $('#racingAdditionalContainer').ready(showPenalty);

    if ($(location).attr('href').includes('sid=racing&tab=log&raceID=')) {
        $('#racingupdatesnew').ready(addPlaybackButton);
    }

    try {
        parseRacingData(JSON.parse(xhr.responseText));
    } catch (e) {
        console.debug('[Racing Enhancements PDA] Could not parse racing data', e);
    }

    // Highlight JLT custom events
    const JltColor = '#fff200';
    if ($('#racingAdditionalContainer').size() > 0 && $('#racingAdditionalContainer').find('div.custom-events-wrap').size() > 0) {
        $('#racingAdditionalContainer').find('div.custom-events-wrap').find('ul.events-list > li').each((i, li) => {
            if ($(li).find('li.name').size() > 0 && $(li).find('li.name').text().trim().startsWith('JLT-')) {
                $(li).addClass('gold');
                $(li).css('color', JltColor).css('text-shadow', `0 0 1px ${JltColor}`);
                $(li).find('span.laps').css('color', JltColor);
            }
        });
    }
});

checkPenalty();

// Set up things that depend on jQuery being around in PDA
jqueryDependantInitializations();
function jqueryDependantInitializations() {
    try {
        $("#racingupdatesnew").ready(addSettingsDiv);
        $("#racingupdatesnew").ready(showSpeed);
        $('#racingAdditionalContainer').ready(showPenalty);

        if ($(location).attr('href').includes('index.php')) {
            $('#mainContainer').ready(displayDailyGains);
        }
        if ($(location).attr('href').includes('sid=racing&tab=log&raceID=')) {
            $('#racingupdatesnew').ready(addPlaybackButton);
        }

        // Hide playback button when changing race tabs
        $('#racingupdatesnew').ready(function() {
            $('div.racing-main-wrap').find('ul.categories > li > a').on('click', function() {
                $('#racingupdatesnew').find('div.race-player-container').hide();
            });
        });

        if ((FETCH_RS || SHOW_SKINS) && $(location).attr('href').includes('sid=racing')) {
            $("#racingupdatesnew").ready(function() {
                updateDriversList();
                new MutationObserver(updateDriversList).observe(document.getElementById('racingAdditionalContainer'), {childList: true});
            });
        }

        // Styles
        GM_addStyle(`
        .rs-display { position: absolute; right: 5px; }
        ul.driver-item > li.name { overflow: auto; }
        li.name .race_position {
          background:url(/images/v2/racing/car_status.svg) 0 0 no-repeat;
          display:inline-block; width:20px; height:18px; vertical-align:text-bottom;
        }
        li.name .race_position.gold {   background-position:0 0; }
        li.name .race_position.silver { background-position:0 -22px; }
        li.name .race_position.bronze { background-position:0 -44px; }
        `);

        GM_addStyle(`
        .rs-display {
        position: absolute;
        right: 5px;
        }
        ul.driver-item > li.name {
          overflow: auto;
        }
        li.name .race_position {
          background:url(/images/v2/racing/car_status.svg) 0 0 no-repeat;
          display:inline-block;
          width:20px;
          height:18px;
          vertical-align:text-bottom;
        }
        li.name .race_position.gold {
          background-position:0 0;
        }
        li.name .race_position.silver {
          background-position:0 -22px;
        }
        li.name .race_position.bronze {
          background-position:0 -44px;
        }`);

    } catch(e) {
        // keep trying until jQuery is defined in PDA shell
        if (e instanceof ReferenceError) {
            setTimeout(jqueryDependantInitializations, 1000);
        }
    }
}
