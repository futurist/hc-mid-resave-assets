const pkg = require('./package.json');
const debug = require('debug')(pkg.name);
const dotenv = require('dotenv');
const assert = require('assert');
const linkify = require('linkify-it')();
const fetch = require('node-fetch');
const replaceString = require('replace-string');
const _ = require('lodash');
const ALY = require('aliyun-sdk');
const cheerio = require('cheerio');
const marked = require('marked');
const qs = require('qs');
linkify.tlds(require('tlds'));

module.exports = (app, appConfig) => {
  dotenv.config();

  const ossConfig = {
    accessKeyId: _.get(appConfig, 'oss.accessKeyId') || process.env.ALIOSS_AK_ID,
    secretAccessKey: _.get(appConfig, 'oss.secretAccessKey') || process.env.ALIOSS_AK,
    region: _.get(appConfig, 'oss.region') || process.env.ALIOSS_REGION,
    bucket: _.get(appConfig, 'oss.bucket') || process.env.ALIOSS_BUCKET,
  }

  assert(ossConfig.accessKeyId, 'config.oss.accessKeyId is empty!!');
  assert(ossConfig.secretAccessKey, 'config.oss.secretAccessKey is empty!!');
  assert(ossConfig.region, 'config.oss.region is empty!!');
  assert(ossConfig.bucket, 'config.oss.bucket is empty!!');

  var ossStream = require('aliyun-oss-upload-stream')(new ALY.OSS(Object.assign({
    endpoint: `http://${ossConfig.region}.aliyuncs.com`,
    apiVersion: '2013-10-15'
  }, ossConfig)));
  return (req, res, next = ()=>{}) => {
    const {body={}, query={}, headers={}} = req;
    if (_.isEmpty(body)) {
      return next();
    }

    const headerResavePath = headers['x-resave-path'];
    const resavePath = !_.isEmpty(headerResavePath) ? qs.parse(headers['x-resave-path']) : appConfig.resavePath;
    const bodyStringArr = []
    _.forEach(resavePath, (arr, type)=>{
      arr.forEach(path=>{
        let doc = _.get(body, path);
        if(!_.isString(doc) || !doc) return;
        let html = doc;
        if(/md|markdown/i.test(type)) {
          html = marked(doc);
        }
        bodyStringArr.push({
          type,
          path,
          doc,
          html
        })
      })
    })

    const start = Date.now();
    console.log(bodyStringArr);

    // get image links
    const allLinks = _.uniq(_.flatten(bodyStringArr.map(x=>{
      const $ = cheerio.load(x.html);
      return _.flatten($('img').map((i,e)=>{
        return e.attribs.src
      }));
    })));

    console.log(allLinks);
    
    Promise.all(allLinks.map(link => fetch(link)
      .then(r => {
        return new Promise((res, rej) => {
          const filename = newID();
          var upload = ossStream.upload({
            Bucket: 'tianchifile',
            Key: filename
          });

          // 可选配置
          upload.minPartSize(1048576); // 1M，表示每块part大小至少大于1M

          upload.on('error', function (error) {
            console.log('error:', error);
            res({link, error});
          });

          upload.on('part', function (part) {
            console.log('part:', part);
          });

          upload.on('uploaded', function (details) {
            var s = (new Date() - startTime) / 1000;
            console.log('details:', details);
            console.log('Completed upload in %d seconds', s);
            res({link, filename});
          });

          r.body.pipe(upload);

          var startTime = new Date();
        });
      })
      .catch(error => {
        return {link, error};
      })
    )).then(results => {
      results.forEach(({link, error, filename}) => {
        bodyString = replaceString(bodyString, link, filename || 'http://');
      });
      console.log(results, bodyString, Date.now() - start);
      req.body = JSON.parse(bodyString);
      next();
    }).catch(err => {
      next(err);
    });
  };
};

function newID() {
  return (Date.now() + Math.random()).toString(36).replace('.', '');
}
