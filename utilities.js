const fs = require("fs");

module.exports.createDir = function(path) {
    if(!fs.existsSync(path)) {
        fs.mkdirSync(path);
    }
}

module.exports.readFile = function(filePath) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, (err, data) => {
            if(err) reject(err);
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