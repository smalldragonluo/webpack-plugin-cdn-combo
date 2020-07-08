const Template = require('webpack/lib/Template');

class CdnComboPlugin {
  constructor(options = {}) {
    this.options = options;
    this.allowList = options.allowList || [];
  }

  apply(compiler) {
    const needChunkOnDemandLoadingCode = chunk => {
      for (const chunkGroup of chunk.groupsIterable) {
        if (chunkGroup.getNumberOfChildren() > 0) return true;
      }
      return false;
    };

    // to override the built-in plugin's output, you need to tap the 'compilation' hook,
    // which is after the hook that JsonpMainTemplatePlugin taped
    compiler.hooks.compilation.tap('JsonpTemplatePlugin', compilation => {
      const { mainTemplate } = compilation;

      // rewrite load script logic
      mainTemplate.hooks.requireExtensions.tap(
        'JsonpMainTemplatePlugin',
        (source, chunk, hash) => {
          const extraCode = [];
          const crossOriginLoading =
            mainTemplate.outputOptions.crossOriginLoading;
          const chunkLoadTimeout = mainTemplate.outputOptions.chunkLoadTimeout;
          const jsonpScriptType = mainTemplate.outputOptions.jsonpScriptType;

          if (needChunkOnDemandLoadingCode(chunk)) {
            extraCode.push(
              `// the CDN prefixes that support combo service
              var comboCdnPrefixes = ${JSON.stringify(this.allowList, null, 2)};
              var useCdnCombo = false;
              var batchLoadQueue = [];
              var finalPublicPath = ${mainTemplate.requireFn}.p;
              var batchInterval;
              
              Object.defineProperty(${mainTemplate.requireFn}, 'p', {
                get: function() {
                  return finalPublicPath;
                },
                set: function(newVal) {
                  finalPublicPath = newVal;
                  handleSetPublicPath();
                }
              });
              
              handleSetPublicPath();
              
              function handleSetPublicPath() {
                useCdnCombo = false;
                  
                // consider the situation without Array polyfill
                for(var i = 0; i < comboCdnPrefixes.length; i++) {
                  if (finalPublicPath.indexOf(comboCdnPrefixes[i]) > -1) {
                    useCdnCombo = true;
                    break;
                  }
                }

                clearInterval(batchInterval);

                if (useCdnCombo) {
                  batchInterval = setInterval(loadQueueScripts, 30);
                }
              }
              
              function loadQueueScripts() {
                if (batchLoadQueue.length) {
                  var currentQueue = batchLoadQueue;
                  var src = finalPublicPath + '??' + currentQueue.map(function (chunk) {
                    var chunkId = chunk.chunkId;
                    return ${getScriptSrcPath(hash, chunk, 'chunkId')};
                  }).join(',');

                  loadScript(src, function(event) {
                    currentQueue.forEach(function(chunk) {
                      chunk.callback(event);
                    });
                  });
                  // clear last queue
                  batchLoadQueue = [];
                }
              }

              function loadScript(src, onLoadCallback) {
                var script = document.createElement('script');
                var onScriptComplete;

                ${
                jsonpScriptType
                  ? `script.type = ${JSON.stringify(jsonpScriptType)};`
                  : ''
              }

                script.charset = 'utf-8';
                script.timeout = ${chunkLoadTimeout / 1000};

                if (${mainTemplate.requireFn}.nc) {
                  script.setAttribute('nonce', ${mainTemplate.requireFn}.nc);
                }

                script.src = src;

                ${
                crossOriginLoading
                  ? Template.asString([
                    'if (script.src.indexOf(window.location.origin + \'/\') !== 0) {',
                    Template.indent(
                      `script.crossOrigin = ${JSON.stringify(crossOriginLoading)};`
                    ),
                    '}'
                  ])
                  : ''
                }

                onScriptComplete = function (event) {
                  // avoid mem leaks in IE.
                  script.onerror = script.onload = null;
                  clearTimeout(timeout);
                  onLoadCallback && onLoadCallback(event);
                };

                var timeout = setTimeout(function () {
                  onScriptComplete({ type: 'timeout', target: script });
                }, 120000);

                script.onerror = script.onload = onScriptComplete;
                document.head.appendChild(script);
              }

              function batchLoadScript(chunkId, onLoadCallback) {
                batchLoadQueue.push({
                  chunkId: chunkId,
                  callback: onLoadCallback
                });
              }`
            );
          }
          if (extraCode.length === 0) return source;
          return Template.asString([source, ...extraCode]);
        }
      );

      // when processed by JsonpMainTemplatePlugin
      if (mainTemplate.hooks.jsonpScript) {
        mainTemplate.hooks.jsonpScript.tap(
          'JsonpMainTemplatePlugin',
          (_, chunk, hash) => {
            return Template.asString([
              `// create error before stack unwound to get useful stacktrace later
              var error = new Error();

              if (useCdnCombo) {
                batchLoadScript(chunkId, onload);
              } else {
                loadScript(jsonpScriptSrc(chunkId), onload);
              }

              function onload(event) {
                var chunk = installedChunks[chunkId];
                if (chunk !== 0) {
                  if (chunk) {
                    var errorType = event && (event.type === 'load' ? 'missing' : event.type);
                    var realSrc = event && event.target && event.target.src;
                    error.message = 'Loading chunk ' + chunkId + ' failed.\\n(' + errorType + ': ' + realSrc + ')';
                    error.name = 'ChunkLoadError';
                    error.type = errorType;
                    error.request = realSrc;
                    chunk[1](error);
                  }
                  installedChunks[chunkId] = undefined;
                }
              }`,
            ]);
          }
        );
      }

      // override the closing logic
      mainTemplate.hooks.requireEnsure.tap(
        'JsonpMainTemplatePlugin load',
        (source, chunk, hash) => {
          return Template.asString([
            source.split('// JSONP chunk loading for javascript')[0] || '',
            '// JSONP chunk loading for javascript',
            '',
            'var installedChunkData = installedChunks[chunkId];',
            'if(installedChunkData !== 0) { // 0 means "already installed".',
            Template.indent([
              '',
              '// a Promise means "currently loading".',
              'if(installedChunkData) {',
              Template.indent(['promises.push(installedChunkData[2]);']),
              '} else {',
              Template.indent([
                '// setup Promise in chunk cache',
                'var promise = new Promise(function(resolve, reject) {',
                Template.indent([
                  'installedChunkData = installedChunks[chunkId] = [resolve, reject];'
                ]),
                '});',
                'promises.push(installedChunkData[2] = promise);',
                '',
                '// start chunk loading',
                mainTemplate.hooks.jsonpScript.call('', chunk, hash),
              ]),
              '}'
            ]),
            '}'
          ]);
        }
      );

      // webpack internal plugin didn't export this function
      const getScriptSrcPath = (hash, chunk, chunkIdExpression) => {
        const chunkFilename = mainTemplate.outputOptions.chunkFilename;
        const chunkMaps = chunk.getChunkMaps();

        return mainTemplate.getAssetPath(JSON.stringify(chunkFilename), {
          hash: `" + ${mainTemplate.renderCurrentHashCode(hash)} + "`,
          hashWithLength: length =>
            `" + ${mainTemplate.renderCurrentHashCode(hash, length)} + "`,
          chunk: {
            id: `" + ${chunkIdExpression} + "`,
            hash: `" + ${JSON.stringify(
              chunkMaps.hash
            )}[${chunkIdExpression}] + "`,
            hashWithLength(length) {
              const shortChunkHashMap = Object.create(null);
              for (const chunkId of Object.keys(chunkMaps.hash)) {
                if (typeof chunkMaps.hash[chunkId] === 'string') {
                  shortChunkHashMap[chunkId] = chunkMaps.hash[chunkId].substr(
                    0,
                    length
                  );
                }
              }
              return `" + ${JSON.stringify(
                shortChunkHashMap
              )}[${chunkIdExpression}] + "`;
            },
            name: `" + (${JSON.stringify(
              chunkMaps.name
            )}[${chunkIdExpression}]||${chunkIdExpression}) + "`,
            contentHash: {
              javascript: `" + ${JSON.stringify(
                chunkMaps.contentHash.javascript
              )}[${chunkIdExpression}] + "`
            },
            contentHashWithLength: {
              javascript: length => {
                const shortContentHashMap = {};
                const contentHash = chunkMaps.contentHash.javascript;
                for (const chunkId of Object.keys(contentHash)) {
                  if (typeof contentHash[chunkId] === 'string') {
                    shortContentHashMap[chunkId] = contentHash[chunkId].substr(
                      0,
                      length
                    );
                  }
                }
                return `" + ${JSON.stringify(
                  shortContentHashMap
                )}[${chunkIdExpression}] + "`;
              }
            }
          },
          contentHashType: 'javascript'
        });
      };
    });
  }
}

module.exports = CdnComboPlugin;
