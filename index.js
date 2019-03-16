const pkg = require('./package.json');
const debug = require('debug')(pkg.name);
const path = require('path');
const dotenv = require('dotenv');
const assert = require('assert');
const linkify = require('linkify-it')();
const fetch = require('node-fetch');
const replaceString = require('replace-string');
const _ = require('lodash');
const OSS = require('ali-oss');
const cheerio = require('cheerio');
const marked = require('marked');
const qs = require('qs');
const imageType = require('image-type');

linkify.tlds(require('tlds'));

module.exports = (app, appConfig) => {
  dotenv.config();

  const ossConfig = {
    accessKeyId: _.get(appConfig, 'oss.accessKeyId') || process.env.ALIOSS_AK_ID,
    accessKeySecret: _.get(appConfig, 'oss.accessKeySecret') || process.env.ALIOSS_AK,
    region: _.get(appConfig, 'oss.region') || process.env.ALIOSS_REGION,
    bucket: _.get(appConfig, 'oss.bucket') || process.env.ALIOSS_BUCKET,
  }

  assert(ossConfig.accessKeyId, 'config.oss.accessKeyId is empty!!');
  assert(ossConfig.accessKeySecret, 'config.oss.accessKeySecret is empty!!');
  assert(ossConfig.region, 'config.oss.region is empty!!');
  assert(ossConfig.bucket, 'config.oss.bucket is empty!!');

  console.log(ossConfig);
  const client = new OSS(ossConfig);
  
  return (req, res, next = ()=>{}) => {
    const {body, query, headers={}} = req;
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
      .then(r => r.buffer())
      .then(buffer => {
        const imgInfo = imageType(buffer);
        console.log(imgInfo);
        if(imgInfo==null) {
          return {link, error: new Error('not image file')};
        }
        const filename = newID() + '.' + imgInfo.ext;
        return client.put(filename, buffer)
        .then(result=>{
          return {link, result};
        }).catch(error=>{
          console.log(filename, error);
          return {link, error};
        });
      })
      .catch(error => {
        return {link, error};
      })
    )).then(results => {
      console.log(1234, results, Date.now() - start);
      bodyStringArr.forEach(item=>{
        results.forEach(({link, error, result}) => {
          item.doc = replaceString(item.doc, link, result ? result.name : '#');
        });
        _.set(body, item.path, item.doc);
      });
      console.log(body);
      next();
    }).catch(err => {
      next(err);
    });
  };
};

function newID() {
  return (Date.now() + Math.random()).toString(36).replace('.', '');
}
