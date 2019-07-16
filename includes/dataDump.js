"use strict";

const logger = require("./includes/logger.js");

const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout
});

let logPath = "./logs/depopulate.js";

module.exports.destroy = function (conn, user) {
    return new Promise((resolve, reject) => {
        readline.question(`WARNING: This action will depopulate the entire salesforce database at ${conn.instanceUrl} with user ${user}. Continue? (y/n) `, (decision) => {
            if (decision.toLowerCase() === "y" || decision.toLowerCase() === "yes") {
                console.log("Destroying database...");

                let order = require("./includes/objectOrder.js").order.slice();
                executeOrder66(order.pop(), order, conn).then(() => {
                    resolve(0);
                }).catch((err) => {
                    reject(err);
                });
            } else {
                console.log("Aborting");
                resolve(1);
            }
        });
    });
}

function executeOrder66(current, queue, conn) {
    return query(conn, `SELECT Id FROM ${current}`, current).then((res) => {
        console.log(`Deleted ${res.successes} records from ${current}. ${res.failures} errors`);
        let next = queue.pop();
        if (next) {
            return executeOrder66(next, queue, conn);
        } else {
            return;
        }
    });
}

function query(conn, queryString, current) {
    return new Promise((resolve, reject) => {
        let records = [];
        conn.query(queryString).on("record", (record) => {
            records.push(record);
        }).on("end", () => {
            let ids = [];
            for (let i = 0; i < records.length; i++) {
                ids.push(records[i].Id);
            }

            deleteRecords(conn, current, ids).then((res) => {
                resolve(res);
            }).catch((err) => {
                reject(err);
            });
        }).on("error", (err) => {
            reject(err);
        }).run({ autoFetch: true });
    });
}

function deleteRecords(conn, object, ids) {
    return new Promise((resolve, reject) => {
        conn.sobject(object).destroy(ids, (err, ret) => {
            if (err) {
                console.log(`Error deleting records :: ${err}`);
                reject(err);
            }

            let successes = 0;
            let failures = 0;
            let retObj = {};

            if (Array.isArray(ret)) {
                for (let i = 0; i < ret.length; i++) {
                    if (ret[i].success) {
                        successes++;
                    } else {
                        console.log(`Error on ${object} ${ret.id} ::`);
                        console.log(ret.errors);
                        failures++;
                    }
                }
            } else {
                if (ret.success) {
                    successes++;
                } else {
                    failures++;
                }
            }

            retObj = { successes: successes, failures: failures };

            resolve(retObj);
        });
    });
}