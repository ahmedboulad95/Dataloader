"use strict";

const fs = require('fs');
const moment = require('moment');
const path = require('path');
const self = this;

const debug = {
    ERROR: "error",
    WARN: "warn",
    INFO: "info",
    VERBOSE: "verbose",
    DEBUG: "debug",
    SILLY: "silly"
}

module.exports.debug = debug;

let logString = "";

/**
 * @param {String} logPath - path of log file
 * @param {this.debug} errorLevel - level of log
 * @param {String} message - message to log
 */
exports.log = function (logPath, errorLevel, message) {
    let timeStamp = moment().format('YYYY-MM-DD HH:mm:ss');
    let callerFileName = path.basename(self._getCallerFile());
    logString += `${timeStamp} ${errorLevel} [${callerFileName}]: ${message}\n\r`;

    if(errorLevel === debug.ERROR) {
        exports.flush(logPath);
    }
}

exports._getCallerFile = function () {
    let originalFunc = Error.prepareStackTrace;

    let callerfile;
    try {
        let err = new Error();
        let currentfile;

        Error.prepareStackTrace = function (err, stack) {
            return stack;
        };

        currentfile = err.stack.shift().getFileName();

        while (err.stack.length) {
            callerfile = err.stack.shift().getFileName();

            if (currentfile !== callerfile) break;
        }
    } catch (e) {}

    Error.prepareStackTrace = originalFunc;

    return callerfile;
}

/**
 * @param {String} logPath - path of log file
 */
exports.flush = function(logPath) {
    let log = logString;
    logString = "";
    fs.appendFile(logPath, log, function (err) {
        if (err) {
            console.log(`ERROR WRITING TO LOG FILE - ${logPath} :: ${err}`)
        }
    });
}