var PROXY_URL = 'http://127.0.0.1:3000';
var SERVICE_ID = 'yourdomain.StalkerProxy';

function wakeLocalService() {
  return new Promise(function(resolve) {
    try {
      tizen.application.launchAppControl(
        new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/default'),
        SERVICE_ID,
        function() {
          setTimeout(resolve, 300);
        },
        function() {
          resolve();
        }
      );
    } catch (e) {
      resolve();
    }
  });
}

function applyTheme(themeName) {
  document.body.className = '';
  if (themeName && themeName !== 'blue') {
    document.body.classList.add('theme-' + themeName);
  }
}

function StalkerAPI(proxyUrl) {
  this.proxyUrl = proxyUrl;
  this.token = null;
  this.seriesModule = 'series';
}

StalkerAPI.prototype.request = function(params) {
  var queryParams = Object.assign({}, params, { JsHttpRequest: '1-xml' });
  var query = Object.keys(queryParams).map(function(k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(queryParams[k]);
  }).join('&');

  var headers = {
    'x-stalker-portal': localStorage.getItem('cfg_portal') || '',
    'x-stalker-mac': localStorage.getItem('cfg_mac') || ''
  };
  if (this.token) {
    headers['x-stalker-token'] = this.token;
  }

  var self = this;
  return fetch(self.proxyUrl + '?' + query, { headers: headers })
    .then(function(res) {
      return res.json();
    })
    .then(function(data) {
      if (data && data.error) {
        throw new Error(data.error);
      }
      return data ? data.js : null;
    });
};

StalkerAPI.prototype.boot = function() {
  var self = this;
  return self.request({ type: 'stb', action: 'handshake', token: '' })
    .then(function(hs) {
      if (!hs || !hs.token) {
        throw new Error('Handshake rejected');
      }
      self.token = hs.token;
      return self.request({
        type: 'stb',
        action: 'get_profile',
        hd: '1',
        sn: '0123456789ABCDEF',
        stb_type: 'MAG250',
        image_version: '218',
        hw_version: '1.7-BD-00'
      });
    })
    .then(function() {
      setInterval(function() {
        wakeLocalService().then(function() {
          self.request({
            type: 'watchdog',
            action: 'get_events',
            cur_play_type: 1,
            event_active_id: 0
          }).catch(function() {});
        });
      }, 60000);
    });
};

StalkerAPI.prototype.fetchLiveCatalog = function() {
  var cached = localStorage.getItem('stalker_live');
  if (cached) {
    this.refreshLiveInBackground();
    return Promise.resolve(JSON.parse(cached));
  }
  return this.refreshLiveInBackground();
};

StalkerAPI.prototype.refreshLiveInBackground = function() {
  var self = this;
  return Promise.all([
    self.request({ type: 'itv', action: 'get_genres' }),
    self.request({ type: 'itv', action: 'get_all_channels' })
  ]).then(function(results) {
    var genresRes = results[0];
    var channelsRes = results[1];
    var genres = [
      { id: '*', title: 'All Channels' },
      { id: 'fav', title: '★ Favorites' },
      { id: 'rec', title: '⏱ History' }
    ].concat((genresRes || []).map(function(g) {
      return { id: String(g.id), title: g.title };
    }));
    var channels = (channelsRes && channelsRes.data ? channelsRes.data : []).map(function(ch) {
      return {
        id: String(ch.id),
        num: Number(ch.number) || 0,
        name: ch.name,
        genreId: String(ch.tv_genre_id),
        cmd: ch.cmd,
        isVod: false,
        isSeries: false
      };
    });
    var catalog = { genres: genres, channels: channels };
    try {
      localStorage.setItem('stalker_live', JSON.stringify(catalog));
    } catch (e) {}
    return catalog;
  });
};

StalkerAPI.prototype.fetchVodCategories = function() {
  return this.request({ type: 'vod', action: 'get_categories' })
    .then(function(res) {
      return [
        { id: '*', title: 'All Movies' },
        { id: 'fav', title: '★ Favorites' },
        { id: 'rec', title: '⏱ History' }
      ].concat((res || []).map(function(c) {
        return { id: String(c.id), title: c.title };
      }));
    });
};

StalkerAPI.prototype.fetchVodPage = function(categoryId, page, searchQuery, sortBy) {
  var params = {
    type: 'vod',
    action: 'get_ordered_list',
    category: categoryId || '*',
    p: page || 1,
    sortby: sortBy || 'added'
  };
  if (searchQuery) {
    params.search = searchQuery;
  }
  return this.request(params).then(function(res) {
    var raw = res && res.data ? res.data : [];
    return raw.filter(function(m) {
      return String(m.is_series) !== '1';
    }).map(function(m) {
      return {
        id: String(m.id),
        name: m.name || m.o_name || 'Untitled',
        cmd: m.cmd,
        desc: m.description || m.actors || '',
        year: m.year || '',
        rating: m.rating_imdb || m.rating_kinopoisk || '',
        isVod: true,
        isSeries: false
      };
    });
  });
};

StalkerAPI.prototype.fetchSeriesCategories = function() {
  var self = this;
  return self.request({ type: 'series', action: 'get_categories' })
    .then(function(res) {
      if (Array.isArray(res) && res.length > 0) {
        self.seriesModule = 'series';
        return [
          { id: '*', title: 'All Series' },
          { id: 'fav', title: '★ Favorites' }
        ].concat(res.map(function(c) {
          return { id: String(c.id), title: c.title };
        }));
      }
      self.seriesModule = 'vod';
      return self.fetchVodCategories();
    })
    .catch(function() {
      self.seriesModule = 'vod';
      return self.fetchVodCategories();
    });
};

StalkerAPI.prototype.fetchSeriesPage = function(categoryId, page, searchQuery, sortBy) {
  var self = this;
  var params = {
    type: self.seriesModule,
    action: 'get_ordered_list',
    category: categoryId || '*',
    p: page || 1,
    sortby: sortBy || 'added'
  };
  if (searchQuery) {
    params.search = searchQuery;
  }
  return this.request(params).then(function(res) {
    var list = res && res.data ? res.data : [];
    if (self.seriesModule === 'vod') {
      list = list.filter(function(item) {
        return String(item.is_series) === '1';
      });
    }
    return list.map(function(s) {
      return {
        id: String(s.id),
        name: s.name || s.o_name || 'Series',
        cmd: s.cmd || '',
        desc: s.description || s.actors || '',
        year: s.year || '',
        rating: s.rating_imdb || '',
        isVod: true,
        isSeries: true
      };
    });
  });
};

StalkerAPI.prototype.fetchSeasons = function(seriesItem) {
  var self = this;
  return self.request({
    type: self.seriesModule,
    action: 'get_ordered_list',
    movie_id: seriesItem.id,
    season_id: 0,
    episode_id: 0,
    p: 1
  }).then(function(res) {
    var data = res && res.data ? res.data : [];
    return data.map(function(s, idx) {
      return {
        id: String(s.id || (idx + 1)),
        name: s.name || ('Season ' + (idx + 1)),
        seriesId: seriesItem.id,
        seriesName: seriesItem.name,
        cmd: s.cmd || seriesItem.cmd || '',
        episodesRaw: Array.isArray(s.series) ? s.series : [],
        desc: s.description || seriesItem.desc || '',
        year: s.year || seriesItem.year || '',
        isSeason: true
      };
    });
  });
};

StalkerAPI.prototype.fetchEpisodes = function(seasonItem) {
  var self = this;
  if (Array.isArray(seasonItem.episodesRaw) && seasonItem.episodesRaw.length > 0) {
    var mapped = seasonItem.episodesRaw.map(function(ep, idx) {
      if (typeof ep === 'object' && ep !== null) {
        var numObj = ep.series_number || ep.episode_num || ep.id || (idx + 1);
        return {
          id: String(ep.id || (seasonItem.id + '_' + numObj)),
          name: ep.name || ('Episode ' + numObj),
          cmd: ep.cmd || seasonItem.cmd || ('/media/file_' + seasonItem.seriesId + '.mpg'),
          seriesNum: numObj,
          seasonId: seasonItem.id,
          movieId: seasonItem.seriesId,
          desc: ep.description || seasonItem.desc,
          year: seasonItem.year,
          isVod: true,
          isEpisode: true,
          streamType: self.seriesModule
        };
      }
      var epNum = ep;
      return {
        id: String(seasonItem.id + '_' + epNum),
        name: 'Episode ' + epNum,
        cmd: seasonItem.cmd || ('/media/file_' + seasonItem.seriesId + '.mpg'),
        seriesNum: epNum,
        seasonId: seasonItem.id,
        movieId: seasonItem.seriesId,
        desc: seasonItem.desc,
        year: seasonItem.year,
        isVod: true,
        isEpisode: true,
        streamType: self.seriesModule
      };
    });
    return Promise.resolve(mapped);
  }

  var numericSeasonId = String(seasonItem.id).indexOf(':') !== -1 ? String(seasonItem.id).split(':').pop() : seasonItem.id;
  return self.request({
    type: self.seriesModule,
    action: 'get_ordered_list',
    movie_id: seasonItem.seriesId,
    season_id: numericSeasonId,
    episode_id: 0,
    p: 1
  }).then(function(res) {
    var data = res && res.data ? res.data : [];
    var nestedSeries = [];
    for (var k = 0; k < data.length; k++) {
      if (String(data[k].id) === String(seasonItem.id) && Array.isArray(data[k].series) && data[k].series.length > 0) {
        nestedSeries = data[k].series;
        break;
      }
    }
    if (nestedSeries.length > 0) {
      return nestedSeries.map(function(epNum) {
        return {
          id: String(seasonItem.id + '_' + epNum),
          name: 'Episode ' + epNum,
          cmd: seasonItem.cmd || ('/media/file_' + seasonItem.seriesId + '.mpg'),
          seriesNum: epNum,
          seasonId: seasonItem.id,
          movieId: seasonItem.seriesId,
          desc: seasonItem.desc,
          year: seasonItem.year,
          isVod: true,
          isEpisode: true,
          streamType: self.seriesModule
        };
      });
    }
    var validEpisodes = data.filter(function(d) {
      return !Array.isArray(d.series);
    });
    return validEpisodes.map(function(ep, i) {
      var epNum = ep.series_number || ep.episode_num || (i + 1);
      return {
        id: String(ep.id || epNum),
        name: ep.name || ('Episode ' + epNum),
        cmd: ep.cmd || seasonItem.cmd || ('/media/file_' + ep.id + '.mpg'),
        seriesNum: epNum,
        seasonId: seasonItem.id,
        movieId: seasonItem.seriesId,
        desc: ep.description || seasonItem.desc,
        year: seasonItem.year,
        isVod: true,
        isEpisode: true,
        streamType: self.seriesModule
      };
    });
  });
};

StalkerAPI.prototype.fetchShortEpg = function(chId) {
  return this.request({ type: 'itv', action: 'get_short_epg', ch_id: chId, size: 4 })
    .then(function(res) {
      return Array.isArray(res) ? res : [];
    });
};

StalkerAPI.prototype.resolveStream = function(item) {
  var self = this;
  var cmd = item.cmd || '';
  if (cmd.indexOf('localhost') !== -1 || item.isVod || item.isEpisode) {
    var primaryType = item.streamType || (item.isVod ? 'vod' : 'itv');
    if (item.isEpisode) {
      primaryType = 'vod';
    }
    var reqParams = {
      type: primaryType,
      action: 'create_link',
      cmd: cmd
    };
    if (item.seriesNum !== undefined && item.seriesNum !== null) {
      reqParams.series = item.seriesNum;
    }
    if (self.token) {
      reqParams.token = self.token;
    }

    return self.request(reqParams).then(function(res) {
      if (res && res.cmd) {
        return res.cmd;
      }
      var fallbackParams = Object.assign({}, reqParams, { type: primaryType === 'vod' ? 'series' : 'vod' });
      return self.request(fallbackParams).then(function(r2) {
        if (r2 && r2.cmd) {
          return r2.cmd;
        }
        if (item.isEpisode && item.movieId) {
          return self.request({
            type: 'vod',
            action: 'get_ordered_list',
            movie_id: item.movieId,
            season_id: item.seasonId || 0,
            episode_id: item.id,
            p: 1
          }).then(function(epRes) {
            var epData = epRes && epRes.data && epRes.data[0] ? epRes.data[0] : null;
            if (epData && epData.cmd) {
              return self.request({
                type: 'vod',
                action: 'create_link',
                cmd: epData.cmd,
                series: item.seriesNum,
                token: self.token
              }).then(function(r3) {
                return r3 && r3.cmd ? r3.cmd : epData.cmd;
              });
            }
            return cmd;
          });
        }
        return cmd;
      });
    }).catch(function() {
      return cmd;
    });
  }
  return Promise.resolve(cmd);
};

var api = new StalkerAPI(PROXY_URL);
var modes = [
  { id: 'live', title: 'Live TV' },
  { id: 'vod', title: 'Movies' },
  { id: 'series', title: 'Series' },
  { id: 'search', title: 'Search' },
  { id: 'settings', title: 'Settings' }
];

var modeIdx = 0, catIdx = 0, itemIdx = 0;
var activeCol = 'items';
var liveGenres = [], allChannels = [], vodCats = [], seriesCats = [];
var rawCats = [], rawItems = [];
var currentCats = [], currentItems = [];
var catFilterText = '', itemFilterText = '';
var currentSort = 'added';

var vodPage = 1, vodLoading = false;
var seriesStack = [];

var isPlayingVod = false, isPaused = false;
var currentPlayingItem = null, previousLiveChannel = null;
var retryCount = 0;
var currentAspect = 'PLAYER_DISPLAY_MODE_LETTER_BOX';
var audioTracks = [], audioIdx = 0;
var textTracks = [], textIdx = -1;

var uiVisible = true, zapTimeout = null, osdTimeout = null, previewEpgTimeout = null;
var numBuffer = '', numTimeout = null;
var exitConfirmPending = false, exitConfirmTimeout = null;

var settingsOpen = false, settingsIdx = 0, imeActive = false;
var searchOpen = false, searchIdx = 0, searchResults = [], searchDebounce = null;
var filterOpen = false, filterIdx = 0, filterTargetCol = 'items';

var modesColEl = document.getElementById('modes-col');
var catsColEl = document.getElementById('cats-col');
var itemsColEl = document.getElementById('items-col');
var modesListEl = document.getElementById('modes-list');
var catsListEl = document.getElementById('cats-list');
var itemsListEl = document.getElementById('items-list');
var catsHeaderEl = document.getElementById('cats-header');
var itemsHeaderEl = document.getElementById('items-header');

var previewTitleEl = document.getElementById('preview-title');
var previewMetaEl = document.getElementById('preview-meta');
var previewDescEl = document.getElementById('preview-desc');
var filterBadgeEl = document.getElementById('filter-badge');
var clockDisplayEl = document.getElementById('clock-display');

var overlayEl = document.getElementById('ui-overlay');
var numOsdEl = document.getElementById('num-osd');
var osdBar = document.getElementById('osd-bar');
var osdTitle = document.getElementById('osd-title');
var osdStatus = document.getElementById('osd-status');
var epgNow = document.getElementById('epg-now');
var epgNext = document.getElementById('epg-next');
var vodProgressWrap = document.getElementById('vod-progress-wrap');
var vodProgressBar = document.getElementById('vod-progress-bar');

var settingsModal = document.getElementById('settings-modal');
var settingsEls = [
  document.getElementById('inp-portal'),
  document.getElementById('inp-mac'),
  document.getElementById('sel-theme'),
  document.getElementById('btn-save'),
  document.getElementById('btn-cancel')
];

var searchModal = document.getElementById('search-modal');
var searchInput = document.getElementById('inp-search');
var searchResultsContainer = document.getElementById('search-results');

var filterModal = document.getElementById('filter-modal');
var filterModalTitle = document.getElementById('filter-modal-title');
var filterEls = [
  document.getElementById('inp-filter'),
  document.getElementById('btn-filter-apply'),
  document.getElementById('btn-filter-clear')
];

function updateClock() {
  var d = new Date();
  var hh = d.getHours();
  var mm = d.getMinutes();
  clockDisplayEl.textContent = (hh < 10 ? '0' + hh : hh) + ':' + (mm < 10 ? '0' + mm : mm);
}
setInterval(updateClock, 15000);
updateClock();

function preloadCatalogCategories() {
  if (!vodCats.length) {
    api.fetchVodCategories().then(function(cats) {
      vodCats = cats;
    }).catch(function() {});
  }
  if (!seriesCats.length) {
    api.fetchSeriesCategories().then(function(cats) {
      seriesCats = cats;
    }).catch(function() {});
  }
}

function getFavList(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch (e) {
    return [];
  }
}

function isFavItem(item) {
  if (!item || item.isPlaceholder || item.isSeason) {
    return false;
  }
  if (item.isSeries) {
    return getFavList('fav_series_objs').some(function(x) {
      return String(x.id) === String(item.id);
    });
  }
  if (item.isVod) {
    return getFavList('fav_vod_objs').some(function(x) {
      return String(x.id) === String(item.id);
    });
  }
  return getFavList('fav_live').indexOf(String(item.id)) !== -1;
}

function toggleFavorite(item) {
  if (!item || item.isPlaceholder || item.isSeason || item.isEpisode) {
    return;
  }
  if (item.isSeries) {
    var sFavs = getFavList('fav_series_objs');
    var sIdx = -1;
    for (var i = 0; i < sFavs.length; i++) {
      if (String(sFavs[i].id) === String(item.id)) {
        sIdx = i;
        break;
      }
    }
    if (sIdx === -1) {
      sFavs.unshift(item);
      showOSD(item.name, '★ Added Series to Favorites');
    } else {
      sFavs.splice(sIdx, 1);
      showOSD(item.name, 'Removed from Favorites');
    }
    localStorage.setItem('fav_series_objs', JSON.stringify(sFavs.slice(0, 60)));
  } else if (item.isVod) {
    var vFavs = getFavList('fav_vod_objs');
    var vIdx = -1;
    for (var j = 0; j < vFavs.length; j++) {
      if (String(vFavs[j].id) === String(item.id)) {
        vIdx = j;
        break;
      }
    }
    if (vIdx === -1) {
      vFavs.unshift(item);
      showOSD(item.name, '★ Added Movie to Favorites');
    } else {
      vFavs.splice(vIdx, 1);
      showOSD(item.name, 'Removed from Favorites');
    }
    localStorage.setItem('fav_vod_objs', JSON.stringify(vFavs.slice(0, 60)));
  } else {
    var lFavs = getFavList('fav_live');
    var strId = String(item.id);
    var lIdx = lFavs.indexOf(strId);
    if (lIdx === -1) {
      lFavs.push(strId);
      showOSD(item.name, '★ Added Channel to Favorites');
    } else {
      lFavs.splice(lIdx, 1);
      showOSD(item.name, 'Removed from Favorites');
    }
    localStorage.setItem('fav_live', JSON.stringify(lFavs));
  }

  if (currentCats[catIdx] && currentCats[catIdx].id === 'fav') {
    selectCategory();
  } else {
    renderUI();
  }
}

function getRecentItems(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch (e) {
    return [];
  }
}

function pushRecentItem(item) {
  if (!item || item.isPlaceholder || item.isSeason || item.isSeries || item.isCategoryResult) {
    return;
  }
  var key = item.isVod ? 'rec_vod' : 'rec_items';
  var rec = getRecentItems(key).filter(function(r) {
    return String(r.id) !== String(item.id);
  });
  rec.unshift(item);
  if (rec.length > 30) {
    rec = rec.slice(0, 30);
  }
  try {
    localStorage.setItem(key, JSON.stringify(rec));
  } catch (e) {}
}

function saveResumeTime(itemId, ms, duration) {
  if (!itemId || !duration || duration <= 0) {
    return;
  }
  try {
    var map = JSON.parse(localStorage.getItem('vod_resume') || '{}');
    if (ms / duration > 0.92) {
      map[itemId] = { pos: 0, done: true };
    } else if (ms > 15000) {
      map[itemId] = { pos: ms, done: false };
    }
    localStorage.setItem('vod_resume', JSON.stringify(map));
  } catch (e) {}
}

function getResumeInfo(itemId) {
  try {
    var map = JSON.parse(localStorage.getItem('vod_resume') || '{}');
    return map[itemId] || null;
  } catch (e) {
    return null;
  }
}

function formatTime(ms) {
  var totalSec = Math.max(0, Math.floor((ms || 0) / 1000));
  var h = Math.floor(totalSec / 3600);
  var m = Math.floor((totalSec % 3600) / 60);
  var s = totalSec % 60;
  var pad = function(n) {
    return n < 10 ? '0' + n : String(n);
  };
  return (h > 0 ? h + ':' : '') + pad(m) + ':' + pad(s);
}

function showOSD(title, status, nowText, nextText) {
  status = status || 'Playing';
  osdTitle.textContent = title;
  osdStatus.textContent = status;
  if (nowText !== undefined) {
    epgNow.innerHTML = '<span>' + (isPlayingVod ? 'INFO:' : 'NOW:') + '</span> ' + (nowText || '--');
  }
  if (nextText !== undefined) {
    epgNext.innerHTML = '<span>' + (isPlayingVod ? 'PLOT:' : 'NEXT:') + '</span> ' + (nextText || '--');
  }
  vodProgressWrap.classList.toggle('visible', isPlayingVod);
  osdBar.classList.add('visible');
  clearTimeout(osdTimeout);
  osdTimeout = setTimeout(function() {
    osdBar.classList.remove('visible');
  }, 4500);
}

function applyColumnFilters() {
  if (catFilterText) {
    var cq = catFilterText.toLowerCase();
    currentCats = rawCats.filter(function(c) {
      return c.title && c.title.toLowerCase().indexOf(cq) !== -1;
    });
  } else {
    currentCats = rawCats.slice();
  }
  if (catIdx >= currentCats.length) {
    catIdx = 0;
  }

  if (itemFilterText && !seriesStack.length) {
    var iq = itemFilterText.toLowerCase();
    currentItems = rawItems.filter(function(i) {
      return i.name && i.name.toLowerCase().indexOf(iq) !== -1;
    });
  } else if (!seriesStack.length) {
    currentItems = rawItems.slice();
  }
  if (itemIdx >= currentItems.length) {
    itemIdx = 0;
  }

  var activeFilters = [];
  if (catFilterText) {
    activeFilters.push('Cat: "' + catFilterText + '"');
  }
  if (itemFilterText) {
    activeFilters.push('Item: "' + itemFilterText + '"');
  }
  if (activeFilters.length) {
    filterBadgeEl.textContent = 'Filter: ' + activeFilters.join(' | ') + ' (Press Blue to clear)';
    filterBadgeEl.classList.add('visible');
  } else {
    filterBadgeEl.classList.remove('visible');
  }
}

function updatePreviewPanel() {
  clearTimeout(previewEpgTimeout);
  var item = currentItems[itemIdx];
  if (!item || item.isPlaceholder) {
    previewTitleEl.textContent = modes[modeIdx] ? modes[modeIdx].title : 'SmartSTB';
    previewMetaEl.textContent = '';
    previewDescEl.textContent = 'Select a category or item to view live program info, plot synopsis, and controls.';
    return;
  }

  previewTitleEl.textContent = item.num ? item.num + '. ' + item.name : item.name;
  var metaParts = [];
  if (item.year) {
    metaParts.push('Year: ' + item.year);
  }
  if (item.rating) {
    metaParts.push('IMDb: ★ ' + item.rating);
  }
  if (item.isSeason && Array.isArray(item.episodesRaw)) {
    metaParts.push(item.episodesRaw.length + ' Episodes');
  }
  var resume = getResumeInfo(item.id);
  if (resume && resume.pos > 0) {
    metaParts.push('Resume: ' + formatTime(resume.pos));
  } else if (resume && resume.done) {
    metaParts.push('✓ Watched');
  }
  previewMetaEl.textContent = metaParts.join('  •  ');

  if (item.isVod || item.isSeries || item.isSeason || item.isEpisode) {
    previewDescEl.textContent = item.desc || 'Press OK to open or start playback.';
  } else {
    previewDescEl.textContent = 'Loading EPG schedule...';
    previewEpgTimeout = setTimeout(function() {
      api.fetchShortEpg(item.id).then(function(epg) {
        if (!currentItems[itemIdx] || String(currentItems[itemIdx].id) !== String(item.id)) {
          return;
        }
        if (!epg.length) {
          previewDescEl.textContent = 'No EPG program guide available for this channel.';
          return;
        }
        var lines = epg.map(function(e) {
          return (e.t_time || '') + ' — ' + (e.name || '');
        });
        previewDescEl.innerHTML = lines.join('<br><br>');
      }).catch(function() {
        previewDescEl.textContent = 'EPG unavailable.';
      });
    }, 350);
  }
}

function renderList(container, items, selectedIdx, labelFn, windowSize) {
  container.innerHTML = '';
  windowSize = windowSize || 12;
  if (!items || !items.length) {
    var empty = document.createElement('div');
    empty.className = 'item';
    empty.textContent = 'No items found';
    container.appendChild(empty);
    return;
  }
  var safeIdx = Math.max(0, selectedIdx);
  var half = Math.floor(windowSize / 2);
  var start = Math.max(0, safeIdx - half);
  var end = Math.min(items.length, start + windowSize);
  if (end - start < windowSize) {
    start = Math.max(0, end - windowSize);
  }

  for (var i = start; i < end; i++) {
    var div = document.createElement('div');
    div.className = 'item' + (i === selectedIdx ? ' selected' : '');
    div.textContent = labelFn(items[i]);
    container.appendChild(div);
  }
}

function switchMode() {
  catIdx = 0;
  itemIdx = 0;
  catFilterText = '';
  itemFilterText = '';
  seriesStack = [];
  var mode = modes[modeIdx].id;
  if (mode === 'live') {
    rawCats = liveGenres;
    applyColumnFilters();
    return selectCategory();
  } else if (mode === 'vod') {
    if (!vodCats.length) {
      rawCats = [{ id: '*', title: 'Loading...' }];
      applyColumnFilters();
      renderUI();
      return api.fetchVodCategories().then(function(cats) {
        vodCats = cats;
        rawCats = vodCats;
        applyColumnFilters();
        return selectCategory();
      });
    }
    rawCats = vodCats;
    applyColumnFilters();
    return selectCategory();
  } else if (mode === 'series') {
    if (!seriesCats.length) {
      rawCats = [{ id: '*', title: 'Loading...' }];
      applyColumnFilters();
      renderUI();
      return api.fetchSeriesCategories().then(function(cats) {
        seriesCats = cats;
        rawCats = seriesCats;
        applyColumnFilters();
        return selectCategory();
      });
    }
    rawCats = seriesCats;
    applyColumnFilters();
    return selectCategory();
  } else {
    rawCats = [];
    rawItems = [];
    applyColumnFilters();
    renderUI();
    return Promise.resolve();
  }
}

function selectCategory() {
  itemIdx = 0;
  itemFilterText = '';
  seriesStack = [];
  if (catIdx >= currentCats.length) {
    catIdx = 0;
  }
  var cat = currentCats[catIdx];
  if (!cat) {
    rawItems = [];
    applyColumnFilters();
    renderUI();
    return Promise.resolve();
  }

  var mode = modes[modeIdx].id;
  if (mode === 'live') {
    if (cat.id === '*') {
      rawItems = allChannels.slice();
    } else if (cat.id === 'fav') {
      var favIds = getFavList('fav_live');
      rawItems = allChannels.filter(function(c) {
        return favIds.indexOf(String(c.id)) !== -1;
      });
    } else if (cat.id === 'rec') {
      rawItems = getRecentItems('rec_items');
    } else {
      rawItems = allChannels.filter(function(c) {
        return String(c.genreId) === String(cat.id);
      });
    }
    if (currentSort === 'name') {
      rawItems.sort(function(a, b) {
        return (a.name || '').localeCompare(b.name || '');
      });
    }
    applyColumnFilters();
    renderUI();
    return Promise.resolve();
  } else if (mode === 'vod') {
    if (cat.id === 'fav') {
      rawItems = getFavList('fav_vod_objs');
      applyColumnFilters();
      renderUI();
      return Promise.resolve();
    }
    if (cat.id === 'rec') {
      rawItems = getRecentItems('rec_vod');
      applyColumnFilters();
      renderUI();
      return Promise.resolve();
    }
    vodPage = 1;
    rawItems = [{ name: 'Loading movies...', isPlaceholder: true }];
    applyColumnFilters();
    renderUI();
    return api.fetchVodPage(cat.id, vodPage, '', currentSort).then(function(items) {
      rawItems = items.length ? items : [{ name: 'No movies in this category', isPlaceholder: true }];
      applyColumnFilters();
      renderUI();
    });
  } else if (mode === 'series') {
    if (cat.id === 'fav') {
      rawItems = getFavList('fav_series_objs');
      applyColumnFilters();
      renderUI();
      return Promise.resolve();
    }
    vodPage = 1;
    rawItems = [{ name: 'Loading series...', isPlaceholder: true }];
    applyColumnFilters();
    renderUI();
    return api.fetchSeriesPage(cat.id, vodPage, '', currentSort).then(function(items) {
      rawItems = items.length ? items : [{ name: 'No series in this category', isPlaceholder: true }];
      applyColumnFilters();
      renderUI();
    });
  }
  return Promise.resolve();
}

function toggleSortOrder() {
  var mode = modes[modeIdx].id;
  if (mode === 'live') {
    currentSort = currentSort === 'name' ? 'added' : 'name';
    showOSD('Sort Order', currentSort === 'name' ? 'A - Z Alphabetical' : 'Default Channel Number');
    selectCategory();
  } else if (mode === 'vod' || mode === 'series') {
    currentSort = currentSort === 'added' ? 'name' : 'added';
    showOSD('Sort Order', currentSort === 'name' ? 'A - Z Alphabetical' : 'Recently Added');
    selectCategory();
  }
}

function jumpToCategoryFromSearch(catResult) {
  modeIdx = catResult.targetModeIdx;
  catFilterText = '';
  itemFilterText = '';
  activeCol = 'items';
  overlayEl.classList.remove('hidden');
  uiVisible = true;

  var applyCategorySelection = function(catsList) {
    rawCats = catsList;
    applyColumnFilters();
    var foundCatIdx = 0;
    for (var i = 0; i < currentCats.length; i++) {
      if (String(currentCats[i].id) === String(catResult.catId)) {
        foundCatIdx = i;
        break;
      }
    }
    catIdx = foundCatIdx;
    return selectCategory();
  };

  if (modeIdx === 0) {
    applyCategorySelection(liveGenres);
  } else if (modeIdx === 1) {
    if (vodCats.length) {
      applyCategorySelection(vodCats);
    } else {
      api.fetchVodCategories().then(function(cats) {
        vodCats = cats;
        applyCategorySelection(vodCats);
      });
    }
  } else if (modeIdx === 2) {
    if (seriesCats.length) {
      applyCategorySelection(seriesCats);
    } else {
      api.fetchSeriesCategories().then(function(cats) {
        seriesCats = cats;
        applyCategorySelection(seriesCats);
      });
    }
  }
}

function loadMoreCatalogIfNeeded() {
  var mode = modes[modeIdx].id;
  var cat = currentCats[catIdx];
  if ((mode !== 'vod' && mode !== 'series') || vodLoading || seriesStack.length > 0 || itemFilterText || !cat || cat.id === 'fav' || cat.id === 'rec') {
    return;
  }
  if (itemIdx >= currentItems.length - 3) {
    vodLoading = true;
    vodPage++;
    var fetchPromise = mode === 'vod' ? api.fetchVodPage(cat.id, vodPage, '', currentSort) : api.fetchSeriesPage(cat.id, vodPage, '', currentSort);
    fetchPromise.then(function(nextItems) {
      if (nextItems.length) {
        rawItems = rawItems.concat(nextItems);
        applyColumnFilters();
        renderUI();
      }
      vodLoading = false;
    }).catch(function() {
      vodLoading = false;
    });
  }
}

function drillDownSeries(item) {
  if (item.isSeries) {
    seriesStack.push({
      items: currentItems.slice(),
      itemIdx: itemIdx,
      header: itemsHeaderEl.textContent
    });
    itemIdx = 0;
    currentItems = [{ name: 'Loading seasons...', isPlaceholder: true }];
    itemsHeaderEl.textContent = item.name + ' - Seasons';
    renderUI();
    api.fetchSeasons(item).then(function(seasons) {
      currentItems = seasons.length ? seasons : [{ name: 'No seasons found', isPlaceholder: true }];
      renderUI();
    }).catch(function() {
      currentItems = [{ name: 'Failed to load seasons', isPlaceholder: true }];
      renderUI();
    });
  } else if (item.isSeason) {
    seriesStack.push({
      items: currentItems.slice(),
      itemIdx: itemIdx,
      header: itemsHeaderEl.textContent
    });
    itemIdx = 0;
    currentItems = [{ name: 'Loading episodes...', isPlaceholder: true }];
    itemsHeaderEl.textContent = item.seriesName + ' - ' + item.name;
    renderUI();
    api.fetchEpisodes(item).then(function(episodes) {
      currentItems = episodes.length ? episodes : [{ name: 'No episodes found', isPlaceholder: true }];
      renderUI();
    }).catch(function() {
      currentItems = [{ name: 'Failed to load episodes', isPlaceholder: true }];
      renderUI();
    });
  }
}

function stepOutSeries() {
  if (!seriesStack.length) {
    return false;
  }
  var prev = seriesStack.pop();
  currentItems = prev.items;
  itemIdx = prev.itemIdx;
  itemsHeaderEl.textContent = prev.header;
  renderUI();
  return true;
}

function renderUI() {
  modesColEl.classList.toggle('focused', activeCol === 'modes');
  catsColEl.classList.toggle('focused', activeCol === 'cats');
  itemsColEl.classList.toggle('focused', activeCol === 'items');

  var mode = modes[modeIdx].id;
  if (!seriesStack.length) {
    catsHeaderEl.textContent = mode === 'live' ? 'Genres (' + currentCats.length + ')' : 'Categories (' + currentCats.length + ')';
    var activeCatTitle = currentCats[catIdx] ? currentCats[catIdx].title : '';
    if (mode === 'live') {
      itemsHeaderEl.textContent = activeCatTitle + ' (' + currentItems.length + ')';
    } else if (mode === 'vod') {
      itemsHeaderEl.textContent = 'Movies - ' + activeCatTitle;
    } else if (mode === 'series') {
      itemsHeaderEl.textContent = 'Series - ' + activeCatTitle;
    }
  }

  renderList(modesListEl, modes, modeIdx, function(m) {
    return m.title;
  }, 10);
  renderList(catsListEl, currentCats, catIdx, function(c) {
    return c.title;
  }, 12);
  renderList(itemsListEl, currentItems, itemIdx, function(i) {
    var favPrefix = isFavItem(i) ? '★ ' : '';
    var resumeInfo = (i.isVod || i.isEpisode) ? getResumeInfo(i.id) : null;
    var watchedPrefix = (resumeInfo && resumeInfo.done) ? '✓ ' : ((resumeInfo && resumeInfo.pos > 0) ? '▶ ' : '');
    var numPrefix = i.num ? i.num + '. ' : '';
    var epCountSuffix = (i.isSeason && Array.isArray(i.episodesRaw) && i.episodesRaw.length) ? ' (' + i.episodesRaw.length + ' eps)' : '';
    var yearSuffix = (i.year && !i.isEpisode && !i.isSeason) ? ' (' + i.year + ')' : '';
    return favPrefix + watchedPrefix + numPrefix + i.name + epCountSuffix + yearSuffix;
  }, 12);

  updatePreviewPanel();
}

function handleNumberKey(digit) {
  if (modes[modeIdx].id !== 'live') {
    return;
  }
  if (digit === 0 && numBuffer === '') {
    if (previousLiveChannel) {
      playItem(previousLiveChannel);
    } else {
      showOSD('Recall', 'No Previous Channel');
    }
    return;
  }
  numBuffer += String(digit);
  numOsdEl.textContent = numBuffer;
  numOsdEl.classList.add('visible');
  clearTimeout(numTimeout);
  numTimeout = setTimeout(function() {
    var targetNum = parseInt(numBuffer, 10);
    numBuffer = '';
    numOsdEl.classList.remove('visible');
    var foundIdx = -1;
    for (var i = 0; i < currentItems.length; i++) {
      if (Number(currentItems[i].num) === targetNum) {
        foundIdx = i;
        break;
      }
    }
    if (foundIdx !== -1) {
      itemIdx = foundIdx;
      renderUI();
      playItem(currentItems[itemIdx]);
      return;
    }

    var globalIdx = -1;
    for (var j = 0; j < allChannels.length; j++) {
      if (Number(allChannels[j].num) === targetNum) {
        globalIdx = j;
        break;
      }
    }
    if (globalIdx !== -1) {
      catIdx = 0;
      catFilterText = '';
      itemFilterText = '';
      applyColumnFilters();
      selectCategory().then(function() {
        itemIdx = globalIdx;
        renderUI();
        playItem(currentItems[itemIdx]);
      });
      return;
    }

    showOSD('Channel ' + targetNum, 'Not Found');
  }, 1400);
}

function toggleAspectRatio() {
  try {
    currentAspect = currentAspect === 'PLAYER_DISPLAY_MODE_LETTER_BOX' ? 'PLAYER_DISPLAY_MODE_FULL_SCREEN' : 'PLAYER_DISPLAY_MODE_LETTER_BOX';
    webapis.avplay.setDisplayMethod(currentAspect);
    showOSD(osdTitle.textContent, currentAspect === 'PLAYER_DISPLAY_MODE_FULL_SCREEN' ? 'Aspect: 16:9 Stretch' : 'Aspect: Original Fit');
  } catch (e) {}
}

function cycleAudioTrack() {
  try {
    var tracks = webapis.avplay.getTotalTrackInfo();
    audioTracks = tracks.filter(function(t) {
      return t.type === 'AUDIO';
    });
    if (audioTracks.length <= 1) {
      showOSD(osdTitle.textContent, 'Single Audio Track');
      return;
    }
    audioIdx = (audioIdx + 1) % audioTracks.length;
    var chosen = audioTracks[audioIdx];
    webapis.avplay.setSelectTrack('AUDIO', Number(chosen.index));
    var extra = chosen.extra_info ? JSON.parse(chosen.extra_info) : {};
    showOSD(osdTitle.textContent, 'Audio: ' + (extra.language || ('Track ' + (audioIdx + 1))));
  } catch (e) {
    showOSD(osdTitle.textContent, 'Audio Switch Unavailable');
  }
}

function cycleSubtitles() {
  try {
    var tracks = webapis.avplay.getTotalTrackInfo();
    textTracks = tracks.filter(function(t) {
      return t.type === 'TEXT';
    });
    if (!textTracks.length) {
      showOSD(osdTitle.textContent, 'No Subtitles Available');
      return;
    }
    textIdx++;
    if (textIdx >= textTracks.length) {
      textIdx = -1;
      webapis.avplay.setSilentSubtitle(true);
      showOSD(osdTitle.textContent, 'Subtitles: Off');
      return;
    }
    webapis.avplay.setSilentSubtitle(false);
    var chosen = textTracks[textIdx];
    webapis.avplay.setSelectTrack('TEXT', Number(chosen.index));
    showOSD(osdTitle.textContent, 'Subtitles: Track ' + (textIdx + 1));
  } catch (e) {
    showOSD(osdTitle.textContent, 'Subtitles Unavailable');
  }
}

function openFilterModal() {
  if (activeCol === 'cats') {
    filterTargetCol = 'cats';
    filterModalTitle.textContent = 'Filter Categories';
    filterEls[0].value = catFilterText;
  } else {
    filterTargetCol = 'items';
    filterModalTitle.textContent = 'Filter Channels / Titles';
    filterEls[0].value = itemFilterText;
  }
  filterIdx = 0;
  filterOpen = true;
  filterModal.classList.add('visible');
  renderFilterFocus();
}

function closeFilterModal() {
  filterEls[0].blur();
  imeActive = false;
  filterOpen = false;
  filterModal.classList.remove('visible');
}

function renderFilterFocus() {
  filterEls.forEach(function(el, idx) {
    el.classList.toggle('focused', idx === filterIdx);
  });
}

function applyFilterModalValue(clearAll) {
  var val = clearAll ? '' : filterEls[0].value.trim();
  if (clearAll) {
    catFilterText = '';
    itemFilterText = '';
  } else if (filterTargetCol === 'cats') {
    catFilterText = val;
  } else {
    itemFilterText = val;
  }
  closeFilterModal();
  applyColumnFilters();
  renderUI();
}

function openSettings() {
  settingsEls[0].value = localStorage.getItem('cfg_portal') || 'http://';
  settingsEls[1].value = localStorage.getItem('cfg_mac') || '00:1A:79:';
  settingsEls[2].value = localStorage.getItem('cfg_theme') || 'blue';
  settingsIdx = 0;
  settingsOpen = true;
  settingsModal.classList.add('visible');
  renderSettingsFocus();
}

function closeSettings() {
  settingsEls[0].blur();
  settingsEls[1].blur();
  settingsEls[2].blur();
  imeActive = false;
  settingsOpen = false;
  settingsModal.classList.remove('visible');
}

function renderSettingsFocus() {
  settingsEls.forEach(function(el, idx) {
    el.classList.toggle('focused', idx === settingsIdx);
  });
}

function saveSettingsAndReboot() {
  var newPortal = settingsEls[0].value.trim();
  var newMac = settingsEls[1].value.trim().toUpperCase();
  var newTheme = settingsEls[2].value;

  localStorage.setItem('cfg_portal', newPortal);
  localStorage.setItem('cfg_mac', newMac);
  localStorage.setItem('cfg_theme', newTheme);
  applyTheme(newTheme);

  localStorage.removeItem('stalker_live');
  vodCats = [];
  seriesCats = [];

  closeSettings();
  showOSD('Reconnecting...', newPortal, 'Authenticating MAC: ' + newMac, '');

  return wakeLocalService().then(function() {
    return api.boot();
  }).then(function() {
    return api.fetchLiveCatalog();
  }).then(function(live) {
    liveGenres = live.genres;
    allChannels = live.channels;
    preloadCatalogCategories();
    modeIdx = 0;
    return switchMode();
  }).then(function() {
    if (currentItems.length) {
      playItem(currentItems[0]);
    }
  }).catch(function(err) {
    showOSD('Portal Connection Failed', 'Check Settings', err.message, '');
    openSettings();
  });
}

function openSearch() {
  preloadCatalogCategories();
  searchInput.value = '';
  searchResults = [];
  searchIdx = 0;
  searchOpen = true;
  searchModal.classList.add('visible');
  searchInput.focus();
  imeActive = true;
  renderSearchResults();
}

function closeSearch() {
  searchInput.blur();
  imeActive = false;
  searchOpen = false;
  searchModal.classList.remove('visible');
}

function matchCategoryList(catsArray, query, labelPrefix, targetModeIdx) {
  return (catsArray || []).filter(function(c) {
    return c.id !== '*' && c.id !== 'fav' && c.id !== 'rec' && c.title && c.title.toLowerCase().indexOf(query) !== -1;
  }).slice(0, 15).map(function(c) {
    return {
      isCategoryResult: true,
      targetModeIdx: targetModeIdx,
      catId: c.id,
      name: c.title,
      display: '📂 [' + labelPrefix + ' Category] ' + c.title
    };
  });
}

function executeSearch(query) {
  var q = query.toLowerCase().trim();
  clearTimeout(searchDebounce);
  if (!q) {
    searchResults = [];
    renderSearchResults();
    return;
  }

  var liveCatMatches = matchCategoryList(liveGenres, q, 'Live', 0);
  var vodCatMatches = matchCategoryList(vodCats, q, 'Movie', 1);
  var seriesCatMatches = matchCategoryList(seriesCats, q, 'Series', 2);
  var allCatMatches = liveCatMatches.concat(vodCatMatches).concat(seriesCatMatches);

  var liveMatches = allChannels.filter(function(c) {
    return c.name.toLowerCase().indexOf(q) !== -1;
  }).slice(0, 40).map(function(c) {
    var copy = Object.assign({}, c);
    copy.display = '📺 [Live] ' + c.num + '. ' + c.name;
    return copy;
  });

  searchResults = allCatMatches.concat(liveMatches);
  if (searchIdx > searchResults.length) {
    searchIdx = searchResults.length ? 1 : 0;
  }
  renderSearchResults();

  searchDebounce = setTimeout(function() {
    Promise.all([
      api.fetchVodPage('*', 1, q).catch(function() { return []; }),
      api.fetchSeriesPage('*', 1, q).catch(function() { return []; })
    ]).then(function(res) {
      var updatedVodCats = matchCategoryList(vodCats, q, 'Movie', 1);
      var updatedSeriesCats = matchCategoryList(seriesCats, q, 'Series', 2);
      var refreshedCats = liveCatMatches.concat(updatedVodCats).concat(updatedSeriesCats);

      var vodMatches = (res[0] || []).slice(0, 25).map(function(m) {
        var copy = Object.assign({}, m);
        copy.display = '🎬 [Movie] ' + m.name + (m.year ? ' (' + m.year + ')' : '');
        return copy;
      });
      var seriesMatches = (res[1] || []).slice(0, 25).map(function(s) {
        var copy = Object.assign({}, s);
        copy.display = '📁 [Series] ' + s.name + (s.year ? ' (' + s.year + ')' : '');
        return copy;
      });
      searchResults = refreshedCats.concat(liveMatches).concat(vodMatches).concat(seriesMatches);
      renderSearchResults();
    });
  }, 450);
}

function renderSearchResults() {
  searchInput.classList.toggle('focused', searchIdx === 0);
  if (!searchResults.length) {
    searchResultsContainer.innerHTML = '<div style="color: #6b7280; font-size: 24px; padding: 12px;">Type to search Categories, Live Channels, Movies, or Series...</div>';
    return;
  }
  var activeListIdx = searchIdx === 0 ? -1 : searchIdx - 1;
  renderList(searchResultsContainer, searchResults, activeListIdx, function(item) {
    return item.display;
  }, 7);
}

searchInput.addEventListener('input', function(e) {
  executeSearch(e.target.value);
});

function playItem(item, isAutoRetry) {
  if (!item || item.isPlaceholder) {
    return;
  }
  if (item.isCategoryResult) {
    jumpToCategoryFromSearch(item);
    return;
  }
  if (item.isSeries || item.isSeason) {
    drillDownSeries(item);
    return;
  }

  if (!isAutoRetry) {
    retryCount = 0;
    if (!item.isVod && currentPlayingItem && !currentPlayingItem.isVod && String(currentPlayingItem.id) !== String(item.id)) {
      previousLiveChannel = currentPlayingItem;
    }
    currentPlayingItem = item;
    pushRecentItem(item);
  }

  isPlayingVod = Boolean(item.isVod);
  isPaused = false;
  audioIdx = 0;
  textIdx = -1;
  vodProgressBar.style.width = '0%';

  var displayTitle = item.num ? item.num + '. ' + item.name : item.name;
  showOSD(displayTitle, isAutoRetry ? 'Reconnecting...' : 'Tuning...', 'Loading...', '');
  clearTimeout(zapTimeout);

  zapTimeout = setTimeout(function() {
    api.resolveStream(item).then(function(url) {
      var epgPromise = item.isVod ? Promise.resolve([]) : api.fetchShortEpg(item.id);
      return epgPromise.then(function(epg) {
        var cleanUrl = url.replace(/^(ffmpeg|ffrt\d?|auto)\s+/i, '').trim();
        var nowStr = item.isVod ? (item.year ? 'Released: ' + item.year : 'On-Demand Stream') : (epg[0] ? epg[0].t_time + ' - ' + epg[0].name : 'No EPG');
        var nextStr = item.isVod ? (item.desc || 'Left/Right: Seek 30s | Red: Audio | Blue: Subtitles | Green: Ratio') : (epg[1] ? epg[1].t_time + ' - ' + epg[1].name : '--');

        try {
          var state = webapis.avplay.getState();
          if (state !== 'NONE') {
            webapis.avplay.stop();
            webapis.avplay.close();
          }

          webapis.avplay.open(cleanUrl);
          webapis.avplay.setDisplayRect(0, 0, 1920, 1080);
          webapis.avplay.setDisplayMethod(currentAspect);
          webapis.avplay.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', 2);

          var lastSavedSec = 0;
          webapis.avplay.setListener({
            onbufferingstart: function() {
              showOSD(displayTitle, 'Buffering...', nowStr, nextStr);
            },
            onbufferingprogress: function(percent) {
              osdStatus.textContent = 'Buffering ' + percent + '%';
            },
            onbufferingcomplete: function() {
              showOSD(displayTitle, item.isVod ? 'VOD' : 'Live', nowStr, nextStr);
            },
            oncurrentplaytime: function(currentTime) {
              if (isPlayingVod) {
                var duration = webapis.avplay.getDuration();
                if (duration > 0) {
                  var pct = Math.min(100, Math.floor((currentTime / duration) * 100));
                  vodProgressBar.style.width = pct + '%';
                  osdStatus.textContent = formatTime(currentTime) + ' / ' + formatTime(duration);
                  var curSec = Math.floor(currentTime / 1000);
                  if (Math.abs(curSec - lastSavedSec) >= 5) {
                    lastSavedSec = curSec;
                    saveResumeTime(item.id, currentTime, duration);
                  }
                }
              }
            },
            onerror: function() {
              if (!isPlayingVod && retryCount < 1) {
                retryCount++;
                playItem(item, true);
              } else {
                showOSD(displayTitle, 'Stream Interrupted', nowStr, nextStr);
              }
            },
            onstreamcompleted: function() {
              if (isPlayingVod) {
                saveResumeTime(item.id, 100, 100);
              }
              webapis.avplay.stop();
              if (item.isEpisode && itemIdx + 1 < currentItems.length && currentItems[itemIdx + 1].isEpisode) {
                itemIdx++;
                renderUI();
                playItem(currentItems[itemIdx]);
              } else {
                showOSD(displayTitle, 'Playback Finished');
              }
            }
          });

          webapis.avplay.prepareAsync(function() {
            webapis.avplay.play();
            if (isPlayingVod) {
              var resume = getResumeInfo(item.id);
              if (resume && resume.pos > 15000 && !resume.done) {
                try {
                  webapis.avplay.seekTo(resume.pos);
                  showOSD(displayTitle, 'Resumed at ' + formatTime(resume.pos), nowStr, nextStr);
                  return;
                } catch (e) {}
              }
            }
            showOSD(displayTitle, item.isVod ? 'VOD' : 'Live', nowStr, nextStr);
          }, function() {
            if (!isPlayingVod && retryCount < 1) {
              retryCount++;
              playItem(item, true);
            } else {
              showOSD(displayTitle, 'Stream Offline', nowStr, nextStr);
            }
          });
        } catch (err) {
          showOSD(displayTitle, 'Player Error', err.message, '');
        }
      });
    }).catch(function() {
      showOSD(displayTitle, 'Link Error');
    });
  }, 250);
}

function setupRemote() {
  var keys = [
    'ChannelUp', 'ChannelDown', 'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop',
    'MediaFastForward', 'MediaRewind', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
    'Info', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
  ];
  keys.forEach(function(k) {
    try {
      tizen.tvinputdevice.registerKey(k);
    } catch (e) {}
  });

  window.addEventListener('keydown', function(e) {
    if (imeActive) {
      if (e.keyCode === 65376 || e.keyCode === 65385 || e.keyCode === 13 || e.keyCode === 10009 || e.keyCode === 40) {
        e.preventDefault();
        if (settingsOpen) {
          if (settingsIdx === 2) {
            settingsEls[2].blur();
          } else {
            settingsEls[settingsIdx].blur();
          }
        }
        if (filterOpen) {
          filterEls[0].blur();
          if (e.keyCode === 40) {
            filterIdx = 1;
            renderFilterFocus();
          }
        }
        if (searchOpen) {
          searchInput.blur();
          if (e.keyCode === 40 && searchResults.length) {
            searchIdx = 1;
            renderSearchResults();
          }
        }
        imeActive = false;
      }
      return;
    }

    if (filterOpen) {
      switch (e.keyCode) {
        case 38:
          filterIdx = (filterIdx - 1 + filterEls.length) % filterEls.length;
          renderFilterFocus();
          break;
        case 40:
          filterIdx = (filterIdx + 1) % filterEls.length;
          renderFilterFocus();
          break;
        case 37:
          if (filterIdx === 2) {
            filterIdx = 1;
            renderFilterFocus();
          }
          break;
        case 39:
          if (filterIdx === 1) {
            filterIdx = 2;
            renderFilterFocus();
          }
          break;
        case 13:
          if (filterIdx === 0) {
            imeActive = true;
            filterEls[0].focus();
          } else if (filterIdx === 1) {
            applyFilterModalValue(false);
          } else if (filterIdx === 2) {
            applyFilterModalValue(true);
          }
          break;
        case 10009:
          closeFilterModal();
          break;
      }
      return;
    }

    if (settingsOpen) {
      switch (e.keyCode) {
        case 38:
          settingsIdx = (settingsIdx - 1 + settingsEls.length) % settingsEls.length;
          renderSettingsFocus();
          break;
        case 40:
          settingsIdx = (settingsIdx + 1) % settingsEls.length;
          renderSettingsFocus();
          break;
        case 37:
          if (settingsIdx === 4) {
            settingsIdx = 3;
            renderSettingsFocus();
          } else if (settingsIdx === 2) {
            var sel = settingsEls[2];
            if (sel.selectedIndex > 0) {
              sel.selectedIndex--;
            }
          }
          break;
        case 39:
          if (settingsIdx === 3) {
            settingsIdx = 4;
            renderSettingsFocus();
          } else if (settingsIdx === 2) {
            var selR = settingsEls[2];
            if (selR.selectedIndex < selR.options.length - 1) {
              selR.selectedIndex++;
            }
          }
          break;
        case 13:
          if (settingsIdx === 0 || settingsIdx === 1) {
            imeActive = true;
            settingsEls[settingsIdx].focus();
          } else if (settingsIdx === 2) {
            imeActive = true;
            settingsEls[2].focus();
          } else if (settingsIdx === 3) {
            saveSettingsAndReboot();
          } else if (settingsIdx === 4) {
            closeSettings();
          }
          break;
        case 10009:
          closeSettings();
          break;
      }
      return;
    }

    if (searchOpen) {
      switch (e.keyCode) {
        case 38:
          searchIdx = Math.max(0, searchIdx - 1);
          renderSearchResults();
          break;
        case 40:
          searchIdx = Math.min(searchResults.length, searchIdx + 1);
          renderSearchResults();
          break;
        case 427:
          searchIdx = Math.max(1, searchIdx - 7);
          renderSearchResults();
          break;
        case 428:
          searchIdx = Math.min(searchResults.length, searchIdx + 7);
          renderSearchResults();
          break;
        case 13:
          if (searchIdx === 0) {
            imeActive = true;
            searchInput.focus();
          } else {
            var selected = searchResults[searchIdx - 1];
            closeSearch();
            if (!selected) {
              return;
            }
            if (selected.isCategoryResult) {
              jumpToCategoryFromSearch(selected);
            } else if (selected.isSeries) {
              modeIdx = 2;
              activeCol = 'items';
              overlayEl.classList.remove('hidden');
              uiVisible = true;
              drillDownSeries(selected);
            } else {
              overlayEl.classList.add('hidden');
              uiVisible = false;
              playItem(selected);
            }
          }
          break;
        case 10009:
          closeSearch();
          break;
      }
      return;
    }

    if (e.keyCode >= 48 && e.keyCode <= 57) {
      handleNumberKey(e.keyCode - 48);
      return;
    }

    switch (e.keyCode) {
      case 457:
        if (osdBar.classList.contains('visible')) {
          osdBar.classList.remove('visible');
        } else {
          showOSD(osdTitle.textContent, osdStatus.textContent);
        }
        break;

      case 403:
        if (uiVisible) {
          toggleSortOrder();
        } else {
          cycleAudioTrack();
        }
        break;

      case 404:
        if (uiVisible) {
          openSearch();
        } else {
          toggleAspectRatio();
        }
        break;

      case 405:
        if (uiVisible && activeCol === 'items' && currentItems[itemIdx]) {
          toggleFavorite(currentItems[itemIdx]);
        }
        break;

      case 406:
        if (uiVisible) {
          if (catFilterText || itemFilterText) {
            applyFilterModalValue(true);
            showOSD('Filter Cleared', 'Showing All Items');
          } else {
            openFilterModal();
          }
        } else {
          cycleSubtitles();
        }
        break;

      case 415:
      case 19:
      case 10252:
        if (isPlayingVod) {
          try {
            if (isPaused) {
              webapis.avplay.play();
              isPaused = false;
              showOSD(osdTitle.textContent, 'Playing');
            } else {
              webapis.avplay.pause();
              isPaused = true;
              showOSD(osdTitle.textContent, 'Paused');
            }
          } catch (err) {}
        }
        break;

      case 413:
        try {
          webapis.avplay.stop();
          overlayEl.classList.remove('hidden');
          uiVisible = true;
          showOSD(osdTitle.textContent, 'Stopped');
        } catch (err) {}
        break;

      case 38:
        if (!uiVisible) {
          overlayEl.classList.remove('hidden');
          uiVisible = true;
          return;
        }
        if (activeCol === 'modes') {
          modeIdx = (modeIdx - 1 + modes.length) % modes.length;
          switchMode();
        } else if (activeCol === 'cats' && currentCats.length) {
          catIdx = (catIdx - 1 + currentCats.length) % currentCats.length;
          selectCategory();
        } else if (currentItems.length) {
          itemIdx = (itemIdx - 1 + currentItems.length) % currentItems.length;
          renderUI();
        }
        break;

      case 40:
        if (!uiVisible) {
          overlayEl.classList.remove('hidden');
          uiVisible = true;
          return;
        }
        if (activeCol === 'modes') {
          modeIdx = (modeIdx + 1) % modes.length;
          switchMode();
        } else if (activeCol === 'cats' && currentCats.length) {
          catIdx = (catIdx + 1) % currentCats.length;
          selectCategory();
        } else if (currentItems.length) {
          itemIdx = (itemIdx + 1) % currentItems.length;
          renderUI();
          loadMoreCatalogIfNeeded();
        }
        break;

      case 37:
      case 412:
        if (!uiVisible && isPlayingVod) {
          try {
            webapis.avplay.jumpBackward(30000);
            showOSD(osdTitle.textContent, '-30s');
          } catch (err) {}
        } else if (activeCol === 'items') {
          if (!stepOutSeries()) {
            activeCol = 'cats';
            renderUI();
          }
        } else if (activeCol === 'cats') {
          activeCol = 'modes';
          renderUI();
        }
        break;

      case 39:
      case 417:
        if (!uiVisible && isPlayingVod) {
          try {
            webapis.avplay.jumpForward(30000);
            showOSD(osdTitle.textContent, '+30s');
          } catch (err) {}
        } else if (activeCol === 'modes') {
          if (modes[modeIdx].id === 'search') {
            openSearch();
          } else if (modes[modeIdx].id === 'settings') {
            openSettings();
          } else {
            activeCol = 'cats';
            renderUI();
          }
        } else if (activeCol === 'cats') {
          activeCol = 'items';
          renderUI();
        }
        break;

      case 13:
        if (!uiVisible) {
          overlayEl.classList.remove('hidden');
          uiVisible = true;
        } else if (modes[modeIdx].id === 'search') {
          openSearch();
        } else if (modes[modeIdx].id === 'settings') {
          openSettings();
        } else if (activeCol === 'modes') {
          activeCol = 'cats';
          renderUI();
        } else if (activeCol === 'cats') {
          activeCol = 'items';
          renderUI();
        } else {
          var chosen = currentItems[itemIdx];
          if (chosen && (chosen.isSeries || chosen.isSeason)) {
            drillDownSeries(chosen);
          } else if (currentPlayingItem && String(currentPlayingItem.id) === String(chosen.id)) {
            overlayEl.classList.add('hidden');
            uiVisible = false;
            showOSD(chosen.num ? chosen.num + '. ' + chosen.name : chosen.name, isPlayingVod ? 'VOD' : 'Live');
          } else {
            playItem(chosen);
            overlayEl.classList.add('hidden');
            uiVisible = false;
          }
        }
        break;

      case 427:
        if (uiVisible) {
          if (activeCol === 'cats' && currentCats.length) {
            catIdx = Math.max(0, catIdx - 10);
            selectCategory();
          } else if (activeCol === 'items' && currentItems.length) {
            itemIdx = Math.max(0, itemIdx - 10);
            renderUI();
          }
        } else if (currentItems.length) {
          itemIdx = (itemIdx + 1) % currentItems.length;
          renderUI();
          playItem(currentItems[itemIdx]);
        }
        break;

      case 428:
        if (uiVisible) {
          if (activeCol === 'cats' && currentCats.length) {
            catIdx = Math.min(currentCats.length - 1, catIdx + 10);
            selectCategory();
          } else if (activeCol === 'items' && currentItems.length) {
            itemIdx = Math.min(currentItems.length - 1, itemIdx + 10);
            renderUI();
            loadMoreCatalogIfNeeded();
          }
        } else if (currentItems.length) {
          itemIdx = (itemIdx - 1 + currentItems.length) % currentItems.length;
          renderUI();
          playItem(currentItems[itemIdx]);
        }
        break;

      case 10009:
        if (uiVisible) {
          if (activeCol === 'items' && stepOutSeries()) {
            return;
          }
          if (activeCol === 'modes') {
            if (exitConfirmPending) {
              tizen.application.getCurrentApplication().exit();
            } else {
              exitConfirmPending = true;
              showOSD('Exit Application?', 'Press BACK again within 3s to Exit');
              clearTimeout(exitConfirmTimeout);
              exitConfirmTimeout = setTimeout(function() {
                exitConfirmPending = false;
              }, 3000);
            }
            return;
          }
          overlayEl.classList.add('hidden');
          uiVisible = false;
        } else {
          overlayEl.classList.remove('hidden');
          uiVisible = true;
        }
        break;
    }
  });
}

(function init() {
  var savedTheme = localStorage.getItem('cfg_theme') || 'blue';
  applyTheme(savedTheme);

  setupRemote();
  if (!localStorage.getItem('cfg_portal') || !localStorage.getItem('cfg_mac')) {
    openSettings();
    return;
  }
  showOSD('Starting Local Proxy...', 'Booting');
  wakeLocalService().then(function() {
    return api.boot();
  }).then(function() {
    return api.fetchLiveCatalog();
  }).then(function(live) {
    liveGenres = live.genres;
    allChannels = live.channels;
    preloadCatalogCategories();
    return switchMode();
  }).then(function() {
    if (currentItems.length) {
      playItem(currentItems[0]);
    }
  }).catch(function(err) {
    showOSD('Connection Failed', err.message);
    openSettings();
  });
})();