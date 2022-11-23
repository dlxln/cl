const fs = require('fs');
const _ = require('lodash')
const axios = require('axios')
const request = require('request')
const mkdirp = require('mkdirp')
const moment = require('moment-timezone')
const moment2 = require('moment')
const TIMEZONE = 'Asia/Shanghai'
const images = require('images')
const path = require('path')
const sharp = require('sharp')
const Promise = require('bluebird')
const {
    loadYaml,
    getMD5,
    loadJson,
    getFullUrl,
    toUrlSafeBase64,
    fromUrlSafeBase64,
    timeout
} = require('@vimesh/utils')

const MAX_DAYS = 10


const townLogogram = {
    '定海路街道': "定海",
    '平凉路街道': "平凉",
    '江浦路街道': "江浦",
    '四平路街道': "四平",
    '控江路街道': "控江",
    '长白新村街道': "长白",
    '延吉新村街道': "延吉",
    '殷行街道': "殷行",
    '大桥街道': "大桥",
    '五角场街道': "五场",
    '新江湾城街道': "新湾",
    '长海路街道': "长海",
    '五角场镇': "五镇",
    '欧阳路街道': "欧阳",
    '曲阳路街道': "曲阳",
    '广中路街道': "广中",
    '嘉兴路街道': "嘉兴",
    '凉城新村街道': "凉城",
    '四川北路街道': "川北",
    '北外滩街道': "北外",
    '江湾镇街道': "江湾"
}





const typeNumToStr = {
    '1': 'communities',
    '2': 'companies',
    '3': 'shop',
    '4': 'administrative_village',
    '5': 'ashbin',
    '6': 'hub',
}
// quaVlue: 90, 及格
// preValue: 100, 满分
const INSPECTION_TYPE = {
    ASHBIN: {
        type: `ashbin`,
        value: 35,
        quaVlue: 31,
        preValue: 35,
        folded: 2.1
    },
    "ASHBIN-YANGPU": {
        type: `ashbin`,
        value: 45,
        quaVlue: 40.5,
        preValue: 45,
        folded: 2.1
    },
    SHOP: {
        type: `shop`,
        value: 45,
        quaVlue: 40.5,
        preValue: 45,
        folded: 2.7
    },
    "SHOP-YANGPU": {
        type: `shop`,
        value: 55,
        quaVlue: 49.5,
        preValue: 55,
        folded: 2.7
    },
    ADMINISTRATIVE_VILLAGE: {
        type: `administrative_village`,
        value: 100,
        quaVlue: 90,
        preValue: 100,
        folded: 6
    },
    COMMUNITIES: {
        type: `communities`,
        value: 100,
        quaVlue: 90,
        preValue: 100,
        folded: 40
    },
    COMPANIES: {
        type: `companies`,
        value: 100,
        quaVlue: 90,
        preValue: 100,
        folded: 12
    },
    HUB: {
        type: `hub`,
        value: 100,
        quaVlue: 90,
        preValue: 100,
        folded: 2
    },
}





let URL = "https://apis.map.qq.com/ws/geocoder/v1/?"



var orientationList = {
    "3": 180,
    "6": 90,
    "8": 270
}


var getOrientation = function (orientation) {
    var num = 0
    if (orientation && orientationList[orientation + ""]) num = orientationList[orientation + ""]
    return num
}

var returnOk = function (msg, data, other) {
    other = other || null
    var returnData = {
        code: 200,
        status: 'ok',
        msg: msg,
        data: data
    }
    if (other) {
        returnData['other'] = other
    }
    return returnData
}


var returnError = function (code, msg, other) {
    other = other || null
    var returnData = {
        code: +code,
        status: 'error',
        msg: msg
    }

    if (other) {
        returnData['other'] = other
    }
    return returnData
}



var formatDate = function (dt, format) {
    return moment(dt).tz(TIMEZONE).format(format || 'YYYY-MM-DD')
};
var formatDateMoment = function (dt, format) {
    return moment(dt).tz(TIMEZONE)
};


var getDeadline = function (type) {
    var date = moment().tz(TIMEZONE)
    date = date.subtract(1, 'day').endOf('day')
    return date.format('YYYY-MM-DD')
};

var getDataInfo = function (name, key) {
    if (!key) {
        return dataList[name] || {}
    } else {
        return _.keyBy(dataList[name], key)
    }
}

var toFixed2 = function (valur) {
    valur = valur || 0
    return parseFloat((Math.round(valur * 100) / 100).toFixed(2))
}




var objectMatch = function (oldItem, newItem, excludedValue, pictureValue) {
    excludedValue = excludedValue || []
    pictureValue = pictureValue || []
    var itemList = []
    var result = true;
    _.each(newItem, function (v, k) {
        if (_.indexOf(excludedValue, k) >= 0) {
            return;
        };
        if ((_.isUndefined(v) || _.isNull(v) || !v) && (_.isUndefined(oldItem[k]) || _.isNull(oldItem[k]) || !oldItem[k])) {
            return;
        }
        if (_.indexOf(pictureValue, k) >= 0) {
            if (_.isArray(oldItem[k])) {
                _.each(v, function (img, ks) {
                    var exist = false
                    _.each(oldItem[k], function (img2, k) {
                        if (img2.pic_url == img.pic_url) {
                            exist = true
                        }
                    })
                    if (!exist) {
                        itemList.push(k)
                        result = false;
                    }

                })
            } else {
                if ((oldItem[k] && _.isString(oldItem[k])) || (v.pic_url || "") != (oldItem[k] && oldItem[k].pic_url || "")) {
                    itemList.push(k)
                    result = false;
                }
            }
        } else {
            if (!_.isEqual(oldItem[k], v)) {
                itemList.push(k)
                result = false;
            };
        }
    })
    return {
        result: result,
        itemList: _.union(itemList)
    };
}




var syncImgForUrl = function (iten, itemList, cache, storage, itemStr) {
    var taskTu = []
    var updateItem = {}
    _.each(itemList, type => {
        _.each(iten[type], (img, key) => {
            checkImg(img, type, key)
        })
    })

    function checkImg(img, type, key) {
        if (img) {
            updateItem[type] = updateItem[type] = {}
            var avatarToken = _.cloneDeep(img)
            var imgInfo = null
            if (!fs.existsSync(cache)) {
                mkdirp.sync(cache)
            }
            var cacheUrl = cache + "/" + img
            const sharpStream = sharp({
                failOnError: false
            });
            var url = 'https://sep.limios.cn/@inspection/' + itemStr + '/pictures/' + img + "?`"
            taskTu.push(
                axios({
                    url,
                    method: "GET",
                    responseType: "stream",
                }).then(data => {
                    data.data.pipe(sharpStream);
                    var fileName = getMD5(img).toString() + "-" + img;
                    var file = formatDate(iten['at'], 'YYYYMMDD') + "/" + iten['_id'] + "/" + fileName
                    return sharpStream
                        .clone()
                        .jpeg({
                            quality: 20
                        })
                        .resize({
                            width: 1000,
                            withoutEnlargement: true
                        })
                        .toFile(cacheUrl)
                        .then(er => {

                            updateItem[type][key] = {
                                "file": file,
                                "file_url": toUrlSafeBase64(file)
                            }
                            return CopyImg(file, cacheUrl)
                        })
                })
            )
        } else {
            return ''
        }
    }


    function CopyImg(fileName, filePath) {
        return new Promise((resolve, reject) => {
            storage.putObjectAsFile(fileName, filePath, {}).then(r => {
                fs.unlink(filePath, function (error) { })
                resolve()
            })
        })

    }
    return Promise.all(taskTu).then(er => {
        return updateItem
    }).catch(error => {
        console.log(error);
        return updateItem
    })
}


var syncImgForDate = function (iten, itemList, cache, storage) {
    var taskTu = []
    var updateItem = {}
    _.each(itemList, type => {
        if (type == 'main_picture') {
            checkImg(iten[type], type)
        } else {
            _.each(iten[type], img => {
                checkImg(img, type)
            })
        }
    })

    function checkImg(img, type) {
        if (img) {
            updateItem[type] = updateItem[type] = {}
            var avatarToken = _.cloneDeep(img)
            taskTu.push(cache.get(avatarToken).then(re => {
                var name = re['meta'] && re['meta']['name'] || re.md5
                var basename = path.basename(name)
                var fileName = getMD5(basename).toString() + "-" + basename;
                var file = formatDate(iten['at'], 'YYYYMMDD') + "/" + iten['_id'] + "/" + fileName
                updateItem[type][img['avatarToken']] = {
                    "file": file,
                    "file_url": toUrlSafeBase64(file)
                }
                return CopyImg(file, re['localFilePath'])
            }))
        } else {
            return ''
        }
    }


    function CopyImg(fileName, filePath) {
        return new Promise((resolve, reject) => {
            storage.putObjectAsFile(fileName, filePath, {}).then(r => {
                // fs.unlink(filePath,function(error){})
                resolve()
            })
        })

    }
    if (taskTu.length > 0) {
        return Promise.all(taskTu).then(er => {
            return updateItem
        })
    }
}

var getBase64 = function (imgUrl, type) {
    var that = this;
    this.imgSrc = ''
    try {
        return new Promise((resolve) => {
            request.get({
                url: imgUrl,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/63.0.3239.132 Safari/537.36',
                    'Accept': 'image/webp,image/apng,image/png,image/*,*/*;q=0.8'
                },
                encoding: null
            }, (err, res, body) => {
                let base64 = null
                if (body) {
                    var base = body.toString('base64')
                    var imgType = 'data:' + (_.startsWith(res.headers['content-type'], 'image') ? res.headers['content-type'] : "image/" + type)
                    base64 = imgType + ';base64,' + base;
                }
                resolve(base64)
            })
        })
    } catch (er) {
        return Promise.resolve();
    }
}



var getLocalBase64 = function (imgUrl, storageUrl, type) {
    var that = this;
    this.imgSrc = ''
    try {
        return new Promise((resolve) => {
            var filePath = fromUrlSafeBase64(imgUrl)
            if (imgUrl.indexOf('upload_') >= 0) {
                filePath = imgUrl
            }
            filePath = storageUrl + filePath
            try {
                let base = fs.readFileSync(filePath);
                // base = base.toString('base64')
                // var base64 = 'data:' + ("image/" + type) + ';base64,' + base;
                resolve(base)
            } catch (error) {
                resolve('')
            }

        })
    } catch (er) {
        return Promise.resolve('');
    }
}


var getSelfImage = function (picturesList, iid) {
    var pictures = {}
    var reg = new RegExp(iid + '\\$');
    _.each(_.filter(_.entries(picturesList), p => {
        return reg.test(p[0])
    }), p => {
        let no = +p[0].substring(`${iid}$`.length)
        if (p[1]) {
            pictures[no] = p[1]
        }
    })
    return pictures
}



async function getDateType(ts) {
    var dtype, dtype = '';
    switch (ts) {
        case 'host':
            dtype = 'dh';
            dformat = 'YYYYMMDDHH';
            break
        case 'day':
            dtype = 'dd';
            dformat = 'YYYYMMDD';
            break
        case 'week':
            dtype = 'dw';
            dformat = 'YYYYWW';
            break
        case 'month':
            dtype = 'dm';
            dformat = 'YYYYMM';
            break
        case 'year':
            dtype = 'dy';
            dformat = 'YYYY';
            break
    }
    return {
        dtype,
        dformat
    }
}


async function buildReports(targetDao, sourceDao, tmfield, addData, otherData) {
    let start = null
    var targetModels = $models[targetDao.getFullName()]


    var itemCon = {
        '_id.update': true
    }

    if (otherData['reportkey']) {
        itemCon = {}
        itemCon['_id.' + otherData['reportkey']] = true
    }
    var targetDaoData = await targetDao.get(itemCon)
    let cond = {
        finished_at: {
            $exists: true
        }
    }
    cond[tmfield] = {
        $exists: true
    }
    if (!_.isEmpty(targetDaoData)) {
        start = moment2(targetDaoData.update).tz(TIMEZONE, true)
        cond[tmfield] = {
            $gt: start.toDate()
        }
    } else {
        cond[tmfield] = {
            $gt: moment2('2020-01-01').startOf('day').toDate()
        }
    }
    var rs = await startSyncDate(cond)
    rs = _.flatten(rs)
    let ops = _.map(rs, item => {
        var update = {}
        if (!_.isEmpty(item['$inc'])) update['$inc'] = item['$inc']
        if (!_.isEmpty(item['$push'])) update['$push'] = item['$push']
        if (!_.isEmpty(item['$set'])) update['$set'] = item['$set']
        if (!_.isEmpty(item['$unset'])) update['$unset'] = item['$unset']
        if (_.isEmpty(update)) return null
        return {
            updateOne: {
                filter: {
                    _id: item['_id']
                },
                update: update,
                upsert: !item['$when$']
            }
        }
    })
    ops = _.without(ops, null)
    if (ops.length == 0) return Promise.resolve(true)
    await targetModels.bulkWrite(ops, {
        ordered: true,
        w: 1
    })

    async function startSyncDate(cond) {
        var newDate = {}
        var newDataList = []
        var sort = {}
        sort[tmfield] = 1
        var join = null
        if (otherData['join']) join = otherData['join']
        var dataList = await sourceDao.select({
            cond,
            size: 10,
            sort,
            join
        })
        await Promise.each(dataList['data'] || [], async item => {
            newDate[item['area']] = newDate[item['area']] || {}
            await addData(item, newDate[item['area']], 'day', otherData)
            await addData(item, newDate[item['area']], 'week', otherData)
            await addData(item, newDate[item['area']], 'month', otherData)
            await addData(item, newDate[item['area']], 'year', otherData)


            let itemId = {
                update: true
            }
            if (otherData['reportkey']) {
                itemId = {}
                itemId[otherData['reportkey']] = true
            }

            if (!newDate['area']) newDate['area'] = [{ // 写入更新时间
                _id: itemId,
                '$set': {
                    update: item[tmfield]
                }
            }]
            if (newDate['area'][0]['$set']['update'] < item[tmfield]) newDate['area'][0]['$set']['update'] = item[tmfield]
        })


        _.each(newDate, typeItem => {
            _.each(typeItem, item => {
                newDataList.push(item)
            })
        })
        console.log(otherData.type, newDataList.length);


        return newDataList
    }
}







async function buildRectifyReports(targetDao, rectifyDao, tmfield, addData, otherData) {
    let start = null
    var targetModels = $models[targetDao.getFullName()]
    var targetCond = {}
    targetCond[`_id.${otherData['byName']}`] = true
    var targetDaoData = await targetDao.get(targetCond)
    let cond = otherData['cond'] || {}

    if (!_.isEmpty(targetDaoData)) {
        start = moment2(targetDaoData[otherData['byName']]).tz(TIMEZONE, true)
        cond[tmfield] = {
            $gt: start.toDate()
        }
    } else {
        cond[tmfield] = {
            $gt: moment2('2020-01-01').startOf('day').toDate()
        }
    }


    var rs = await startSyncDate(cond)
    rs = _.flatten(rs)
    let ops = _.map(rs, item => {
        var update = {}
        if (!_.isEmpty(item['$inc'])) update['$inc'] = item['$inc']
        if (!_.isEmpty(item['$push'])) update['$push'] = item['$push']
        if (!_.isEmpty(item['$set'])) update['$set'] = item['$set']
        if (!_.isEmpty(item['$unset'])) update['$unset'] = item['$unset']
        if (_.isEmpty(update)) return null
        return {
            updateOne: {
                filter: {
                    _id: item['_id']
                },
                update: update,
                upsert: !item['$when$']
            }
        }
    })
    ops = _.without(ops, null)
    if (ops.length == 0) return Promise.resolve(true)
    await targetModels.bulkWrite(ops, {
        ordered: true,
        w: 1
    })

    async function startSyncDate(cond) {
        var newDate = {}
        var newDataList = []
        var sort = {}
        sort[tmfield] = 1
        var join = null
        if (otherData['join']) join = otherData['join']
        var dataList = await rectifyDao.select({
            cond,
            size: 10,
            sort,
            join
        })
        var type = otherData['type']

        var {
            dbForm
        } = await $services.sys.getDbInfoByType(type)
        var rectifyList = await dbForm.select({
            cond: {
                '_id': {
                    '$in': _.uniq(_.map(dataList['data'] || [], i => i['form_id']))
                }
            },
            fields: ['_id', 'rectify_success'],
            omit: false
        })
        rectifyList = _.mapValues(_.keyBy(rectifyList['data'], '_id'), v => v['rectify_success'] ? true : false)

        await Promise.each(dataList['data'] || [], async item => {
            if (item.form_id) {
                newDate[item['area']] = newDate[item['area']] || {}
                await addData(item, newDate[item['area']], rectifyList, 'day', otherData)
                await addData(item, newDate[item['area']], rectifyList, 'week', otherData)
                await addData(item, newDate[item['area']], rectifyList, 'month', otherData)
                await addData(item, newDate[item['area']], rectifyList, 'year', otherData)
                if (!newDate['area']) {
                    newDate['area'] = [{ // 写入更新时间
                        _id: {},
                        '$set': {}
                    }]
                    newDate['area'][0]._id[otherData['byName']] = true
                    newDate['area'][0].$set[otherData['byName']] = item[tmfield]
                }

                if (newDate['area'][0]['$set'][otherData['byName']] < item[tmfield]) newDate['area'][0]['$set'][otherData['byName']] = item[tmfield]
            }

        })


        _.each(newDate, typeItem => {
            _.each(typeItem, item => {
                newDataList.push(item)
            })
        })
        return newDataList
    }
}



//测算距离
async function getReportData(list, type, userEx) {



    // quaVlue: 90, 及格
    // preValue: 100, 满分
    var returnData = {
        itme_type: {}, //类型的详情
        number: 0, //巡查总数
        rectify_number: 0, //解决的巡查数
        problem_number: 0, //问题小区数
        pull: 0, //满分
        qualified: 0, //达标数
        total: [], //总分
        folded: 0, //平均
        type_number: 0, //类型的总数
        rectify_type_number: 0 //解决类型的总数
    }

    var area = null;
    await Promise.each(list, v => {
        if (!area && v['_id'] && v['_id']['area']) area = v['_id']['area']
        if (v['itme_type']) {
            _.each(v.itme_type || {}, (it, k) => {
                if (!returnData['itme_type'][k]) returnData['itme_type'][k] = _.assignIn(_.pick(it, 'max', 'text'), {
                    type: 0,
                    type_rectify: 0
                })
                let itme_type = returnData['itme_type'][k]
                itme_type['score'] = _.concat(itme_type['score'] || [], _.values(it['score']))

                let typeNum = _.values(it['type'] || {}).length
                itme_type['type'] += typeNum
                returnData['number_type'] += typeNum

                let typeRectifyNum = _.values(it['type_rectify'] || {}).length
                itme_type['type_rectify'] += typeRectifyNum
                returnData['rectify_type_number'] += typeRectifyNum
            })
        }

        returnData['total'] = _.concat(returnData['total'] || [], _.values(v['total']))
        returnData['rectify_number'] += _.values(v['rectify'] || {}).length
    })

    let baseType = await $services.sys.getbaseType(type, area, userEx)



    if (returnData['itme_type']) {
        _.each(returnData.itme_type || {}, (it, k) => {
            it['score'] = $services.sys.toFixed2(_.mean(it['score']))
        })
    }

    returnData['number'] = returnData['total'].length
    returnData['pull'] = _.filter(returnData['total'], i => i == baseType['preValue']).length
    returnData['qualified'] = _.filter(returnData['total'], i => i >= baseType['quaVlue']).length
    returnData['total'] = $services.sys.toFixed2(_.mean(returnData['total']))
    returnData['folded'] = $services.sys.toFixed2(returnData['total'] * baseType['folded'] / 100)
    returnData['problem_number'] = returnData['number'] - returnData['pull']
    return returnData
}




var removeImgesByFileList = function (imageList) {
    _.each(imageList || [], image => {
        let local = fs.statSync(image)
        if (local.isFile()) {
            fs.unlinkSync(image)
        }
    })
}




//测算距离
async function getGeoInfo(lng, lat, pois) {
    var params = {
        location: lat + ',' + lng,
        key: KEY,
        get_poi: 0
    }

    if (pois) {
        params['get_poi'] = 1
        params["poi_options"] = "address_format=short;radius=5000;policy=2"
    }
    params = $services.sys.sortParams(params)
    var body = await needle("get", URL + params.slice(1))
    return $dao.Geo.getInfoByGeo(body.body, pois)

}

function sortParams(params) {
    let strParam = "";
    let keys = Object.keys(params);
    keys.sort();
    for (let k in keys) {
        strParam += ("&" + keys[k] + "=" + params[keys[k]]);
    }
    return strParam
}


//根据距离计算经纬度的范围
var getNearByGps = function (longitude, latitude, distince) {
    distince = distince / 1000
    let r = 6378.137; // 地球半径千米
    let lng = parseFloat(longitude);
    let lat = parseFloat(latitude);
    let dlng = 2 * Math.asin(Math.sin(distince / (2 * r)) / Math.cos(lat * Math.PI / 180));
    dlng = dlng * 180 / Math.PI; // 角度转为弧度
    let dlat = distince / r;
    dlat = dlat * 180 / Math.PI;
    let minlat = lat - dlat;
    let maxlat = lat + dlat;
    let minlng = lng - dlng;
    let maxlng = lng + dlng;

    return {
        minlng,
        maxlng,
        minlat,
        maxlat
    };
}

//计算距离

var getDistanceByGps = function (longitude1, latitude1, longitude2, latitude2) {
    let r = 6378.137; // 地球半径千米
    let lat1 = parseFloat(latitude1);
    let lng1 = parseFloat(longitude1);
    let lat2 = parseFloat(latitude2);
    let lng2 = parseFloat(longitude2);
    let radLat1 = rad(lat1);
    let radLat2 = rad(lat2);
    let a = radLat1 - radLat2;
    let b = rad(lng1) - rad(lng2);
    let s = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin(a / 2), 2) + Math.cos(radLat1) * Math.cos(radLat2) * Math.pow(Math.sin(b / 2), 2)));

    s = s * r;
    s = Math.round(s * 1000);
    return s;


    function rad(d) {
        return d * Math.PI / 180.0;
    }
}


async function getbaseType(type, area, userEx, item) {
    if (userEx && !_.isEmpty(userEx) && userEx['account_id'] == 1011) {
        if (area) {
            if (_.startsWith(area, '310110')) {
                type += "-yangpu"
            }
        } else {
            type += "-yangpu"
        }
    }

    var returnData = INSPECTION_TYPE[type.toUpperCase()] || {}

    if (type == "shop" && item) {
        if (item['created_at'] <= new Date('2021-02-26')) {
            returnData = {
                type: `shop`,
                value: 60,
                quaVlue: 45,
                preValue: 60,
                folded: 60
            }
        }
    }
    return returnData
}

function getbaseTypeForSync(type, area, userEx, item) {
    if (userEx && !_.isEmpty(userEx) && userEx['account_id'] == 1011) {
        if (area) {
            if (_.startsWith(area, '310110')) {
                type += "-yangpu"
            }
        } else {
            type += "-yangpu"
        }
    }
    var returnData = INSPECTION_TYPE[type.toUpperCase()] || {}

    if (type == "shop" && item) {
        if (item['created_at'] <= new Date('2021-02-26')) {
            returnData = {
                type: `shop`,
                value: 60,
                quaVlue: 45,
                preValue: 60,
                folded: 60
            }
        }
    }
    return returnData
}
const getFormStatus = async function (total, fullScore) {
    return total >= fullScore * 0.9
}




async function getEnumsInfo(res, nameList, data) {
    _.each(nameList, function (name) {
        var valueList = loadYaml('data/enums/' + name + '.yaml');
        var newValueList = []
        _.map(valueList, function (item, key) {
            newValueList.push({
                "label": res.i18n('enums.' + name + '.' + item),
                value: item
            })
        })
        data[name] = newValueList
    })
}



async function getPicturesNum(pictures, item) {
    pictures = pictures || {}
    item = item || ""
    var number = 0
    _.each(pictures, (value, key) => {
        if (key.startsWith(`${item}$`)) {
            let keyNum = parseInt(key.split('$')[1])
            if (number < keyNum) number = keyNum
        }
    })
    return number
}


async function getTypeByNum(type) {
    return typeNumToStr[type + ""]
}


async function getTownLogogram(type) {
    var logStr = townLogogram[type + ""] || type
    return _.endsWith(logStr, '街道') ? logStr.substring(0, logStr.length - '街道'.length) : logStr
}





function getSearchByType(type, keyword) {
    var returnData = {}
    var keyword = new RegExp(`${keyword}`)
    if (type == 'communities') {
        returnData['$or'] = [{ name: keyword }, { address: keyword }]
    }

    if (type == 'companies') {

        returnData['$or'] = [{ name: keyword }, { address: keyword }, { type: keyword }]
    }


    if (type == 'ashbin') {

        returnData['$or'] = [{ number: keyword }, { address: keyword }]
    }


    if (type == 'administrative_village') {
        returnData['name'] = keyword
    }


    if (type == 'shop') {
        returnData['road_name'] = keyword
    }


    if (type == 'hub') {
        returnData['name'] = keyword
    }
    return returnData
}


async function getDbInfoByType(type) {
    if (_.isNumber(type)) type = typeNumToStr[type]
    var jsonName = null
    var fileName = null
    var idName = null
    var db = null
    var dbForm = null
    var dbRectify = null
    var dbBatches = null
    var searchStr = null
    var dbFormsRecord = null
    var dbFormsAreaReport = null
    var dbFormsItemReport = null
    var assetNum = null
    var join = []
    var joinBase = ''
    var joinBasearea = ''
    var dataReportForItem = ''
    var joinRectifyForm = ''
    var _at = 'created_at'
    var joinFormBy = 'created_by > user :  UserEx'


    if (type == 'communities') {
        jsonName = 'community'
        fileName = 'communities'
        idName = 'community_id'
        searchStr = 'name'
        assetNum = '1'
        db = $dao.Communities;
        dbForm = $dao.CommunityForms;
        dbBatches = $dao.CommunityBatches
        dbRectify = $dao.CommunityRectify
        dbFormsRecord = $dao.CommunityFormsRecord
        dbFormsAreaReport = $dao.CommunityFormsAreaReport
        dbFormsItemReport = $dao.CommunityFormsItemReport
        joinBase = idName + ' > ' + type + ' :  Communities'
        joinBasearea = type + '.area' + ' > fullArea :  Areas'
        joinRectifyForm = 'form_id > form :  ' + dbForm.getName()
        dataReportForItem = '_id.item_id' + ' > ' + type + ' : Communities'
        join.push(idName + ' > ' + type + ' :  Communities')
    }

    if (type == 'companies') {
        jsonName = 'company'
        fileName = 'companies'
        idName = 'company_id'
        searchStr = 'name'
        assetNum = '2'
        db = $dao.Companies;
        dbForm = $dao.CompanyForms;
        dbBatches = $dao.CompanyBatches
        dbRectify = $dao.CompanyRectify
        dbFormsRecord = $dao.CompanyFormsRecord
        dbFormsAreaReport = $dao.CompanyFormsAreaReport
        dbFormsItemReport = $dao.CompanyFormsItemReport
        joinBase = idName + ' > ' + type + ' :  Companies'
        joinBasearea = type + '.area' + ' > fullArea :  Areas'
        joinRectifyForm = 'form_id > form :  ' + dbForm.getName()
        dataReportForItem = '_id.item_id' + ' > ' + type + ' : Companies'
        join.push(idName + ' > ' + type + ' :  Companies')
    }


    if (type == 'ashbin') {
        jsonName = 'ashbin'
        fileName = 'ashbin'
        idName = 'ashbin_id'
        searchStr = 'number'
        assetNum = '5'
        db = $dao.Ashbin;
        dbForm = $dao.AshbinForms;
        dbBatches = $dao.AshbinBatches
        dbRectify = $dao.AshbinRectify
        dbFormsRecord = $dao.AshbinFormsRecord
        dbFormsAreaReport = $dao.AshbinFormsAreaReport
        dbFormsItemReport = $dao.AshbinFormsItemReport
        joinBase = idName + ' > ' + type + ' :  Ashbin'
        joinBasearea = type + '.area' + ' > fullArea :  Areas'
        joinRectifyForm = 'form_id > form :  ' + dbForm.getName()
        dataReportForItem = '_id.item_id' + ' > ' + type + ' : Ashbin'
        join.push(idName + ' > ' + type + ' :  Ashbin')
    }


    if (type == 'administrative_village') {
        jsonName = 'administrativeVillage'
        fileName = 'administrativeVillage'
        idName = 'administrativeVillage_id'
        searchStr = 'name'
        assetNum = '4'
        db = $dao.AdministrativeVillage;
        dbForm = $dao.AdministrativeVillageForms;
        dbBatches = $dao.AdministrativeVillageBatches
        dbRectify = $dao.AdministrativeVillageRectify
        dbFormsRecord = $dao.AdministrativeVillageFormsRecord
        dbFormsAreaReport = $dao.AdministrativeVillageFormsAreaReport
        dbFormsItemReport = $dao.AdministrativeVillageFormsItemReport
        joinBase = idName + ' > ' + type + ' :  AdministrativeVillage'
        joinBasearea = type + '.area' + ' > fullArea :  Areas'
        joinRectifyForm = 'form_id > form :  ' + dbForm.getName()
        dataReportForItem = '_id.item_id' + ' > ' + type + ' : AdministrativeVillage'
        join.push(idName + ' > ' + type + ' :  AdministrativeVillage')
    }


    if (type == 'shop' || type == 'shops') {
        jsonName = 'shops'
        fileName = 'shops'
        idName = 'shops_id'
        searchStr = 'road_name'
        assetNum = '3'
        db = $dao.Shops;
        dbForm = $dao.ShopsForms;
        dbBatches = $dao.ShopsBatches
        dbRectify = $dao.ShopsRectify
        dbFormsRecord = $dao.ShopsFormsRecord
        dbFormsAreaReport = $dao.ShopsFormsAreaReport
        dbFormsItemReport = $dao.ShopsFormsItemReport
        joinBase = idName + ' > ' + type + ' :  Shops'
        joinBasearea = type + '.area' + ' > fullArea :  Areas'
        dataReportForItem = '_id.item_id' + ' > ' + type + ' : Shops'
        joinRectifyForm = 'form_id > form :  ' + dbForm.getName()
        join.push(idName + ' > ' + type + ' :  Shops')
    }


    if (type == 'hub') {
        jsonName = 'hub'
        fileName = 'hub'
        idName = 'hub_id'
        searchStr = 'name'
        assetNum = '2'
        db = $dao.Hub;
        dbForm = $dao.HubForms;
        dbBatches = $dao.HubBatches
        dbRectify = $dao.HubRectify
        dbFormsRecord = $dao.HubFormsRecord
        dbFormsAreaReport = $dao.HubFormsAreaReport
        dbFormsItemReport = $dao.HubFormsItemReport
        joinBase = idName + ' > ' + type + ' :  Hub'
        joinBasearea = type + '.area' + ' > fullArea :  Areas'
        dataReportForItem = '_id.item_id' + ' > ' + type + ' : Hub'
        joinRectifyForm = 'form_id > form :  ' + dbForm.getName()
        join.push(idName + ' > ' + type + ' :  Hub')
    }




    return {
        db,
        jsonName,
        fileName,
        dbForm,
        dbBatches,
        join,
        idName,
        joinBase,
        joinBasearea,
        joinFormBy,
        joinRectifyForm,
        searchStr,
        assetNum,
        dbRectify,
        dbFormsRecord,
        dbFormsAreaReport,
        dbFormsItemReport,
        dataReportForItem,
        _at
    }
}




async function getDataListForm(dataList, dbForm, idName, type) {

    try {

        let returnData = []
        let returnDataNum = 0
        let formData = {}

        let idList = []
        dataList['data'] = _.map(dataList['data'], item => {
            idList.push(item._id);
            if (item['type']) item['type_name'] = item['type']
            return _.assignIn(item, {
                type: type
            })
        })
        returnData = returnData.concat(dataList['data'])
        returnDataNum += dataList['count'] || 0
        let cond2 = {
            created_at: getDBTime(formatDate())
        }
        cond2[idName] = {
            '$in': idList
        }
        let formList = await dbForm.select({
            cond: cond2,
            join: ['created_by > user : UserEx ']
        })
        formData[type] = _.keyBy(formList['data'], idName)
        return {
            data: returnData,
            count: returnDataNum,
            formData: formData
        }

    } catch (error) {
        console.log(error);
        return {
            data: [],
            count: 0,
            formData: {}
        }

    }
}


function loadForm(type, area, userEx) {

    if (area && userEx && !_.isEmpty(userEx) && _.startsWith(area, '310110') && userEx['account_id'] == 1011) {
        type += "-yangpu"
    }
    return loadJson(`${__dirname}/../../data/${type}.json`)
}

function shopLoadForm(area, userEx) {
    var form = ''

    // 弃用
    ////黄浦区和徐汇区特殊处理  3101010:黄埔 ；3101040：徐汇区；
    // if (_.startsWith(area, '310101') || _.startsWith(area, '310104') || _.startsWith(area, '310109')) { //
    //     form = loadJson(`${__dirname}/../../data/shops2.json`)
    // } else {
    // }

    //杨浦区 街道巡查添加特殊的巡查标准  310110:杨浦代码  1011：系统中特殊的groupID 
    if (area && _.startsWith(area, '310110') && !_.isEmpty(userEx) && userEx['account_id'] == 1011) {
        form = loadJson(`${__dirname}/../../data/shops-yangpu.json`)
    } else {
        form = loadJson(`${__dirname}/../../data/shops.json`)
    }
    return form
}

function loadFormForShops(shop_info, area, userEx) {
    var form = shopLoadForm(area, userEx)
    var newForm = []
    _.each(shop_info, (v, k) => {
        var cloneForm = _.cloneDeep(form)
        _.each(cloneForm, l1 => {
            l1.index = k + "_" + l1.index
            _.each(l1.details, l2 => {
                l2.index = k + "_" + l2.index
                _.each(l2.details, l3 => {
                    l3.index = k + "_" + l3.index
                })
            })
        })
        newForm.push({
            "index": k,
            "text": v.name,
            "number": v.number,
            "rule": "",
            "max": 35,
            "details": cloneForm
        })
    })
    return newForm
}



async function checkRectify(form, rectify = {}) {
    var returnData = {
        number: 0
    }
    form = form || []
    await Promise.each(form || [], async (l1, v1) => {
        await checkItem(l1, v1, form)
    })
    async function checkItem(item, index, form) {
        var rList = true
        if (item.score && item.score > 0) {
            if (!item.details) {
                if (!rectify[item['index']]) rList = false;
                returnData['number'] += 1
            } else {
                let isRectify = true
                await Promise.each(item.details, async (v, i) => {
                    if (!await checkItem(v, i, form[index].details)) isRectify = rList = false
                })
                if (form[index].details) form[index].details = _.compact(form[index].details)
            }
            form[index]['rectify_success'] = rList
        }
        return rList
    }
    return returnData
}












async function checkRectifyItem(form, indexNUm) {
    var returnData = {
        number: {},
        rectify_number: {}
    }
    form = form || []
    await Promise.each(form || [], async (l1, v1) => {
        await checkItem(l1, v1, form)
    })
    async function checkItem(item, index, form) {
        var rList = true
        if (item.score && item.score > 0) {
            if (!item.details) {
                var key = _.split(item.index, '_')[indexNUm]
                if (!returnData['number'][key]) returnData['number'][key] = 0
                returnData['number'][key] += 1
                if (item['rectify_success']) {
                    if (!returnData['rectify_number'][key]) returnData['rectify_number'][key] = 0
                    returnData['rectify_number'][key] += 1
                }
            } else {
                await Promise.each(item.details || [], async (v, i) => {
                    await checkItem(v, i, form[index].details)
                })
            }
        }
        return rList
    }
    return returnData
}


async function getDatesFormat(end, begin, format) {
    end = moment(end || "")
    begin = moment(begin || "")
    if (end < begin) {
        var temp = end;
        end = begin;
        begin = temp;
    }
    var dates = [];
    dates.push(end.format(format))
    end.subtract('d', 1)
    while (end >= begin) {
        dates.push(end.format(format))
        end.subtract('d', 1)
    }
    return dates;
}



async function getDatesForType(begin, end, format) {
    begin = moment(begin || "")
    end = moment(end || "")
    if (end < begin) {
        var temp = end;
        end = begin;
        begin = temp;
    }
    var datesList = [];
    var monthList = []
    var dayList = []
    while (begin <= end) {
        var strBegin = begin.format(format)
        var monthStart = _.cloneDeep(begin).startOf('month').format(format)
        var monthEnd = _.cloneDeep(begin).endOf('month').format(format)
        if (monthStart == strBegin) monthList.push(+_.cloneDeep(begin).format('YYYYMM'))
        if (monthEnd == strBegin) {
            pushDate(monthList.length > 0 ? "dm" : "dd")
        } else {
            dayList.push(+strBegin)
        }
        begin.add('d', 1)
    }
    pushDate('dd')

    function pushDate(type) {
        if (dayList.length > 0 || monthList.length > 0) {
            if (!datesList[type]) datesList[type] = {
                type: type,
                dateList: []
            }
            datesList[type]['dateList'] = _.concat(datesList[type]['dateList'], type == 'dd' ? dayList : monthList)
        }
        monthList = []
        dayList = []
    }
    return _.values(datesList);
}




function getDateStartAndEnd(type, date) {
    if (!date) date = moment().format('YYYY-MM-DD')
    if (_.isString(date)) date = moment(date || '').tz(TIMEZONE)
    var str = ''
    switch (type) {
        case 'y':
            str = 'year'
            break;
        case 'm':
            str = 'month'
            break;
        case 'd':
            str = 'day'
            break;
    }
    var start = _.cloneDeep(date).startOf(str).format('YYYY-MM-DD HH:mm:ss');
    var end = _.cloneDeep(date).endOf(str).format('YYYY-MM-DD HH:mm:ss');
    return {
        start,
        end
    }

}


async function getReportDate(num) {
    var date = moment().tz(TIMEZONE)
    if (num < 0) {
        date.subtract(num * -1, 'day').endOf('day')
    } else {
        date.add(num, 'day').endOf('day')
    }
    return date

}


function getDBTime(start, end) {
    if (_.isString(start)) start = formatDate(start, 'YYYY-MM-DD HH:mm:ss')
    if (end) {
        if (_.isString(end)) end = formatDateMoment(end).endOf('day')
    } else {
        if (_.isString(start)) {
            end = formatDateMoment(start).endOf('day')
        } else {
            end = start.endOf('day')
        }
    }

    return { '$gte': new Date(start), '$lte': new Date(end) }
}



function getLocalImgFileUrl(Base64, type) {
    try {
        let storage = $portlet.storages[type] && $portlet.storages[type].storage && $portlet.storages[type].storage.storage || null
        let storageUrl = ''
        if (storage) {
            storageUrl = storage.root + '/' + storage.config.bucket + "/" + storage.config.prefix
            storageUrl += fromUrlSafeBase64(Base64)
        }
        return storageUrl

    } catch (error) {
        return ''
    }
}


function getLocalImgFileUrlSize(Base64, type) {
    var returnData = {
        url: null,
        extName: "jpg"
    }
    try {
        let storage = $portlet.storages[type] && $portlet.storages[type].storage && $portlet.storages[type].storage.storage || null
        let storageUrl = ''
        let cacheUrl = ''
        if (storage) {
            storageUrl = storage.root + '/' + storage.config.bucket + "/" + storage.config.prefix
            Base64 = fromUrlSafeBase64(Base64)
            storageUrl += Base64
            cacheUrl = storage.config.cacheDir + "/" + storage.config.prefix
            cacheUrl += Base64
            if (!returnData['extName']) cacheUrl += "jpg"
            returnData['extName'] = _.trimStart(path.extname(storageUrl), '.');
            var fixSize = 200
            var fileSize = fs.statSync(storageUrl).size;
            fileSize = (fileSize / (1024)).toFixed(2)

            if (fs.existsSync(cacheUrl)) {
                var cacheFileSize = fs.statSync(cacheUrl).size;
                cacheFileSize = (cacheFileSize / (1024)).toFixed(2)
                if (cacheFileSize > fixSize || cacheFileSize < 10) $services.sys.removeImgesByFileList([cacheUrl])
            }

            if (!fs.existsSync(cacheUrl)) {
                var cacheUrlPath = path.resolve(cacheUrl, '..')
                if (!fs.existsSync(cacheUrlPath)) {
                    mkdirp.sync(cacheUrlPath)
                }
                var img = images(storageUrl)
                var size = img.size()
                returnData = _.merge(returnData, size)
                let rate = fixSize / fileSize

                let newWidth = size.width * rate
                if (newWidth < 800) newWidth = 800
                img.size(newWidth, size.height / size.width * newWidth)
                img.save(cacheUrl, { quality: 20 })
                returnData['url'] = cacheUrl
            } else {
                returnData['url'] = cacheUrl
            }
        }
        return returnData

    } catch (error) {
        console.log(error);
        return returnData
    }
}



async function itemtemUpdateReport(item, data, ts, rectifyInfo, rectifyList, otherData) {

    rectifyList = _.keyBy(rectifyList, 'item_id')
    if (item.finished_at && item['area']) {
        var {
            dtype,
            dformat
        } = await $services.sys.getDateType(ts)
        var time = +moment(item['created_at']).tz(TIMEZONE, true).format(dformat)
        var key = dtype
        if (!data[key]) {
            data[key] = {
                _id: {
                    account_id: item['account_id'],
                    area: item['area'],
                    province: item['area'].substring(0, 2),
                    city: item['area'].substring(0, 4),
                    county: item['area'].substring(0, 6),
                    town: item['area'].substring(0, 9)
                },
                $set: {},
                $unset: {},
            }
            data[key]['_id'][dtype] = time
        }
        var set = data[key]['$set']
        var unset = data[key]['$unset']

        let indexNUm = _.indexOf(['shop', 'ashbin'], otherData.type) >= 0 ? 1 : 0

        let baseTypeValue = 0
        if (_.isEmpty(item['form'])) item['form'] = []
        await Promise.each(item['form'] || [], async form => {
            if (indexNUm == 1) {
                await Promise.each(form['details'], async details => {
                    await setData(details)
                })
            } else {
                await setData(form)
            }
        })


        let typeInfo = await $services.sys.getbaseType(otherData.type, null, null)
        var total = (typeInfo.preValue - (+item['total'] || 0))
        set[`total.${item._id}`] = total
        async function setData(form) {
            let iTKey = _.split(form.index, '_')[indexNUm]

            let itemType = `itme_type.${iTKey}.type.${item['_id']}`
            let itemTypeRectify = `itme_type.${iTKey}.type_rectify.${item['_id']}`
            let itemScore = `itme_type.${iTKey}.score.${item['_id']}`

            if (form['score'] > 0) {
                await pushItemInfo(itemType, itemTypeRectify, form)
                let score = form['max'] - (form.score >= form['max'] ? form['max'] : form.score)
                set[itemScore] = score
            } else {
                unset[itemType] = 1
                unset[itemScore] = 1
                unset[itemTypeRectify] = 1
            }
        }
        async function pushItemInfo(v1, v2, form) {
            if (!set[v1]) set[v1] = {}
            await Promise.each(form['details'] || [], async (l1, v1) => {
                await checkItem(l1)
            })
            async function checkItem(item) {
                var rList = true
                if (item.score && item.score > 0) {
                    if (!item.details) {
                        set[v1][`${item.index}`] = 1
                        if (!rectifyList[item.index]) {
                            unset[`${v2}.${item.index}`] = 1
                        }
                    } else {
                        await Promise.each(item.details || [], async (v, i) => {
                            await checkItem(v)
                        })
                    }
                }
            }
        }

        if (rectifyInfo[item['form_id']]) {
            set[`rectify.${item.form_id}`] = 1
        } else {
            unset[`rectify.${item.form_id}`] = 1
        }
    }

}



async function againReportById(formId, type) {

    let {
        jsonName,
        dbForm,
        dbRectify,
        dbFormsAreaReport
    } = await $services.sys.getDbInfoByType(type)
    var form = await dbForm.get(formId)
    var rectifyList = await dbRectify.select({
        cond: {
            form_id: formId,
            "return_type": 1,
            'invalid': {
                '$exists': false
            }
        }
    })

    rectifyInfo = _.mapValues(_.keyBy(rectifyList['data'], '_id'), v => v['rectify_success'] ? true : false)

    var dataAreaList = {}
    var dataItemList = {}

    await itemtemUpdateReport(form, dataAreaList, 'day', rectifyInfo, rectifyList, {
        type
    })
    await itemtemUpdateReport(form, dataAreaList, 'week', rectifyInfo, rectifyList, {
        type
    })
    await itemtemUpdateReport(form, dataAreaList, 'month', rectifyInfo, rectifyList, {
        type
    })
    await itemtemUpdateReport(form, dataAreaList, 'year', rectifyInfo, rectifyList, {
        type
    })

    dataAreaList = _.values(dataAreaList)
    let opsDataAreaList = _.map(dataAreaList, item => {
        var update = {}
        if (!_.isEmpty(item['$unset'])) update['$unset'] = item['$unset']
        if (!_.isEmpty(item['$set'])) update['$set'] = item['$set']
        return {
            updateOne: {
                filter: {
                    _id: item['_id']
                },
                update: update,
                upsert: false
            }
        }
    })
    if (dataAreaList.length > 0) {
        dbFormsAreaReport = $models[dbFormsAreaReport.getFullName()]
        await dbFormsAreaReport.bulkWrite(opsDataAreaList, {
            ordered: true,
            w: 1
        })
    }
}



function convertDistance(distance) {
    distance = parseFloat(distance)
    var returnNum = distance + "米"
    if (distance > 1000) {
        returnNum = toFixed2(distance / 1000) + "千米"
    }
    return returnNum
}


function isExcelBaseInfo(area) {
    let areaList = ['310109']
    let saveBaseInfo = false
    _.each(areaList, i => {
        if (_.startsWith(area, i)) saveBaseInfo = true
    })
    return saveBaseInfo
}




async function startProSync() {
    var mainFile = global.$portlet.storages.ashbin.storage.storage.root + "/main"

    var type = [
        {
            name: "administrativeVillage",
            file: mainFile + "/administrativeVillage",
            formdb: $dao.AdministrativeVillageForms2
        },
        {
            name: "ashbin",
            file: mainFile + "/ashbin",
            formdb: $dao.AshbinForms2
        },
        {
            name: "communities",
            file: mainFile + "/communities",
            formdb: $dao.CommunityForms2
        },
        {
            name: "companies",
            file: mainFile + "/companies",
            formdb: $dao.CompanyForms2
        },
        {
            name: "shops",
            file: mainFile + "/shops",
            formdb: $dao.ShopsForms2
        }
    ]

    await Promise.each(type, async t => {
        await startRun(t)
    })
}




async function startRun(type) {
    let fileStr = path.resolve(type.file)
    console.log(fileStr);
    let idexists = await fs.existsSync(fileStr)
    if (idexists) {
        let dateList = await fs.readdirSync(fileStr)
        console.log(dateList);

        await Promise.each(dateList || [], async date => {
            var fileDateStr = path.join(fileStr, date);
            if (date == "20220914") {
                fileDateStr = path.resolve(fileDateStr)
                let idList = await fs.readdirSync(fileDateStr)
                console.log(idList);

                await Promise.each(idList || [], async id => {
                    let at = new Date(moment(date + " 12:00:00", "YYYYMMDD HH:mm:ss"))
                    let dbData = {
                        "_id": id,
                        "by": "",
                        "finished_by": "",
                        "account_id": "",
                        "created_by": "",
                        "area": "",
                        "created_at": at,
                        "at": at,
                        "finished_at": at,
                        "batch_id": parseInt(id.split("-")[0]),
                        "total": 0,
                        "form": [],
                        "data": {},
                        "pictures": {},
                        "shop_info": {}
                    }

                    var fileIdStr = path.join(fileDateStr, id);
                    let imgFile = await fs.readdirSync(fileIdStr)
                    await Promise.each(imgFile, async img => {
                        let imgExt = path.extname(img)
                        if (imgExt == ".jpg") {
                            let nameList = img.split("-")
                            if (type.name == 'shops') {
                                dbData['shop_info'][_.slice(nameList, 2, 3)] = {
                                    "number": 0,
                                    "name": ""
                                }
                            }
                            let ii_data = _.join(_.slice(nameList, 2, nameList.length - 2), "_")
                            dbData['data'][ii_data] = 1
                            let ii_img = _.join(_.slice(nameList, 2, nameList.length - 2), "_") + "$" + nameList[nameList.length - 2]
                            dbData['pictures'][ii_img] = toUrlSafeBase64(`${date}/${id}/${img}`)
                            console.log(ii_data, ii_img);

                        }
                    })

                    let {
                        jsonName,
                        dbForm,
                        fileName,
                        dbRectify
                    } = await $services.sys.getDbInfoByType(type.name)
                    let form = type.name == 'shops' ? ($services.sys.loadFormForShops(dbData.shop_info)) : (await $services.sys.loadForm(jsonName))

                    dbData['form'] = form
                    await type.formdb.calculateScores(form, dbData['data'])

                    console.log(await type.formdb.set(dbData));

                })
            }
        })
    }
}





function setup(options) {
    return {
        formatDate,
        formatDateMoment,
        getDataInfo,
        toFixed2,
        objectMatch,
        syncImgForDate,
        syncImgForUrl,
        returnOk,
        returnError,
        buildReports,
        buildRectifyReports,
        getBase64,
        getLocalBase64,
        getSelfImage,
        removeImgesByFileList,
        getOrientation,
        getGeoInfo,
        getNearByGps,
        getDistanceByGps,
        getFormStatus,
        getbaseType,
        getbaseTypeForSync,
        getEnumsInfo,
        getPicturesNum,
        getDbInfoByType,
        loadForm,
        shopLoadForm,
        loadFormForShops,
        getDataListForm,
        getTypeByNum,
        checkRectify,
        checkRectifyItem,
        getDateType,
        getDatesFormat,
        getDatesForType,
        getDeadline,
        getDateStartAndEnd,
        getTownLogogram,
        getReportDate,
        getReportData,
        againReportById,
        itemtemUpdateReport,
        getLocalImgFileUrl,
        getLocalImgFileUrlSize,
        getSearchByType,
        convertDistance,
        getDBTime,
        isExcelBaseInfo,
        sortParams
    }
}


module.exports = {
    setup
}