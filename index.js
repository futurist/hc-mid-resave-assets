const pkg = require('./package.json');
const debug = require('debug')(pkg.name);
const dotenv = require('dotenv');
const assert = require('assert');
const fetch = require('node-fetch');
const replaceString = require('replace-string');
const _ = require('lodash');
const OSS = require('ali-oss');
const htmlparser = require('htmlparser2');
const marked = require('marked');
const uuid = require('uuid/v4');
const qs = require('qs');
const ms = require('ms');
const urlMatch = require('url-match-patterns').default;
const imageType = require('image-type');
const entities = require("entities");

const check = require('./check');

const defaultHeaders = {
  'Cache-Control': 'public, immutable, max-age=' + ms('1y') / 1000
};
const defaultDir = 'public/assets';

module.exports = (app, appConfig) => {
  dotenv.config();

  const ossConfig = {
    accessKeyId: _.get(appConfig, 'oss.accessKeyId') || process.env.ALIOSS_AK_ID,
    accessKeySecret: _.get(appConfig, 'oss.accessKeySecret') || process.env.ALIOSS_AK,
    region: _.get(appConfig, 'oss.region') || process.env.ALIOSS_REGION,
    bucket: _.get(appConfig, 'oss.bucket') || process.env.ALIOSS_BUCKET,
  };

  assert(ossConfig.accessKeyId, 'config.oss.accessKeyId is empty!!');
  assert(ossConfig.accessKeySecret, 'config.oss.accessKeySecret is empty!!');
  assert(ossConfig.region, 'config.oss.region is empty!!');
  assert(ossConfig.bucket, 'config.oss.bucket is empty!!');

  const ossProtocol = _.get(appConfig, 'oss.protocol') || '';
  let ossDir = _.get(appConfig, 'oss.dir') || defaultDir;
  ossDir = _.trim(ossDir, '/');
  if (ossDir) ossDir += '/';
  const getOSSUrl = (filename) => `${ossProtocol}//${ossConfig.bucket}.${ossConfig.region}.aliyuncs.com/${filename}`;

  debug(ossConfig);
  const client = new OSS(ossConfig);

  return (req, res, next = () => {}) => {
    const {
      body,
      query,
      headers = {}
    } = req;
    if (_.isEmpty(body)) {
      return next();
    }

    const headerResavePath = headers['x-resave-path'];
    const urlsToCheck = _.map(appConfig.resavePath, (v, k) => {
      return [k, v.method];
    });
    const matchedPath = check(urlsToCheck, req.path, req.method);
    const resavePath = !_.isEmpty(headerResavePath) ? qs.parse(headers['x-resave-path']) : matchedPath && appConfig.resavePath[matchedPath[0]];
    if (!resavePath) {
      return next();
    }
    const bodyStringArr = [];
    _.forEach(resavePath, (arr, type) => {
      if (/rich|md|markdown/i.test(type) && _.isArray(arr)) {
        arr.forEach(path => {
          let doc = _.get(body, path);
          if (!_.isString(doc) || !doc) return;
          let html = doc;
          if (/md|markdown/i.test(type)) {
            html = marked(doc);
          }
          bodyStringArr.push({
            type,
            path,
            doc,
            html
          });
        });
      }
    });

    const start = Date.now();
    debug(bodyStringArr);

    // get image links
    const allLinks = _.uniq(_.flatten(bodyStringArr.map(x => {
      return getLinksFromHTML(x.html);
    }))).filter(v=>{
      const e = {link: v, arr: bodyStringArr, req, res};
      if(v.startsWith('//')) {
        v = (_.isFunction(appConfig.getProtocol) ? appConfig.getProtocol(e) : appConfig.getProtocol || req.protocol) + ':' + v
      }
      return _.isFunction(appConfig.ignore)
        ? appConfig.ignore(e)
        : [
          '*://*.aliyuncs.com/*'
        ].concat(appConfig.ignore).filter(Boolean).every(x=>!urlMatch(x, v))
      }
    );

    if (_.isEmpty(allLinks)) {
      return next();
    }

    console.log('resave assets:', allLinks);
    Promise.all(allLinks.map(link => {
      const e = {link, arr: bodyStringArr, req, res};
      let theUrl = entities.decodeHTML(link)
      if(theUrl.startsWith('//')) {
        theUrl = (_.isFunction(appConfig.getProtocol) ? appConfig.getProtocol(e) : appConfig.getProtocol || req.protocol) + ':' + theUrl
      }
      return fetch(theUrl)
      .then(r => r.buffer())
      .then(buffer => {
        const imgInfo = imageType(buffer);
        if (imgInfo == null) {
          return {
            link,
            error: new Error('not image file')
          };
        }
        const filename = ossDir + newID(appConfig, {link, buffer, imgInfo}) + '.' + imgInfo.ext;
        return client.put(filename, buffer, {
          mime: imgInfo.mime,
          headers: _.get(appConfig, 'oss.headers') || defaultHeaders
        })
          .then(result => {
            return {
              link,
              result
            };
          }).catch(error => {
            return {
              link,
              error
            };
          });
      })
      .catch(error => {
        return {
          link,
          error
        };
      })
    })).then(results => {
      debug('results', results, Date.now() - start);
      bodyStringArr.forEach(item => {
        results.forEach(({
          link,
          error,
          result
        }) => {
          item.doc = replaceString(item.doc, link, result ? getOSSUrl(result.name) : '#');
        });
        _.set(body, item.path, item.doc);
      });
      debug('newBody', body);
      if(_.isFunction(appConfig.callback)) {
        appConfig.callback({req, res, arr: bodyStringArr, results});
      }
      next();
    }).catch(err => {
      next(err);
    });
  };
};

function newID(appConfig={}, e) {
  return _.isFunction(appConfig.getFileName) ?
    appConfig.getFileName(e)
    : uuid().replace(/-/g, '');
}

function getLinksFromHTML(html) {
  var links = [];
  var parser = new htmlparser.Parser({
    onopentag: function (name, attribs) {
      if (name == 'img') {
        links.push((attribs.src||'').trim());
      }
    },
  }, {decodeEntities: false});
  parser.write(html);
  parser.end();
  return links.filter(Boolean);
}
