const fs = require("fs");

module.exports.createDir = function(path) {
    if(!fs.existsSync(path)) {
        fs.mkdirSync(path);
    }
}

module.exports.readFile = function(filePath) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, (err, data) => {
            if(err) {
                console.log(err);
                reject(err);
            } 
            resolve(data);
        });
    });
}

module.exports.writeFile = function(filePath, data) {
    return new Promise((resolve, reject) => {
        fs.writeFile(filePath, data, (err) => {
            if(err) reject(err);
            resolve();
        });
    });
}

module.exports.query = function (conn, queryString) {
    return new Promise((resolve, reject) => {
        let records = [];
        conn.query(queryString).on("record", (record) => {
            records.push(record);
        }).on("end", () => {
            resolve(records);
        }).on("error", (err) => {
            reject(err);
        }).run({ autoFetch: true });
    });
}