"use strict";

const jsforce = require("jsforce");
const utilities = require("./utilities.js");
const order = require("./objectOrder.js").order;

const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout
});

require('dotenv').config();

let loginOptions = { loginUrl: process.env.DEV_SF_DEST_ORG_URL };
let conn = new jsforce.Connection(loginOptions);

let user = process.env.DEV_SF_DEST_ORG_USER;
let pass = process.env.DEV_SF_DEST_ORG_PASS;
let token = process.env.DEV_SF_DEST_ORG_TOKEN;

module.exports.destroy = function (conn, user) {
    return new Promise((resolve, reject) => {
        readline.question(`WARNING: This action will depopulate the entire salesforce database at ${conn.instanceUrl} with user ${user}. Continue? (y/n) `, (decision) => {
            if (decision.toLowerCase() === "y" || decision.toLowerCase() === "yes") {
                console.log("Destroying database...");

                executeOrder66(order.shift(), order, conn).then(() => {
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
    return query(conn, `SELECT Id FROM ${current}`).then((records) => {
        let ids = [];
        for (let i = 0; i < records.length; i++) {
            ids.push(records[i].Id);
        }
        console.log(current + " " + ids);

        deleteRecords(conn, current, ids).then((res) => {
            console.log(`Deleted ${res.successes} records from ${current}. ${res.failures} errors`);
            let next = queue.shift();
            if(next) {
                return executeOrder66(next, queue, conn);
            } else {
                return;
            }
        });
    });
}

function query(conn, queryString) {
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

conn.login(user, pass + token, function (err, userInfo) {
    if (err) throw err;

    exports.destroy(conn, userInfo.name).then((res) => {
        if(res === 0) {
            console.log("Finished deleting");
        } else {
            console.log("Delete aborted");
        }
    });
});