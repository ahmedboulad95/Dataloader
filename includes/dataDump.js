"use strict";

const logger = require("./logger.js");

const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout
});

let logPath = "./logs/push.log";

/**
 * @description depopulates an entire salesforce database
 * @param {jsforce.Connection} conn - salesforce connection
 * @param {String} user - currently logged in user id
 * @return {Integer} 0 - depopulation completed successfully, 1 - operation aborted by user
 */
module.exports.destroy = function (conn, user) {
    return new Promise((resolve, reject) => {
        // Give user a chance to abort
        readline.question(`WARNING: This action will depopulate the entire salesforce database at ${conn.instanceUrl} with user ${user}. Continue? (y/n) `, (decision) => {
            logger.log(logPath, logger.debug.INFO, `User delete decision :: ${decision}`);
            if (decision.toLowerCase() === "y" || decision.toLowerCase() === "yes") {
                logger.log(logPath, logger.debug.INFO, "Beginning depopulation");
                console.log("Destroying database...");

                // Get the order that the records were inserted in
                let order = require("./objectOrder.js").order.slice();
                logger.log(logPath, logger.debug.INFO, `Object delete order :: ${order.toString()}`);

                // Recursively delete all records in org. The objects will need to be handled in reverse order to avoid errors
                executeOrder66(order.pop(), order, conn).then(() => {
                    logger.log(logPath, logger.debug.INFO, "Finished depopulating database");

                    // Depopulation successful, return 0 status
                    resolve(0);
                }).catch((err) => {
                    logger.log(logPath, logger.debug.ERROR, `Error depopulating database :: ${err}`);
                    reject(err);
                });
            } else {
                logger.log(logPath, logger.debug.INFO, "Aborting operation...");
                console.log("Aborting");

                // Depopulation aborted, return 1 status so the calling code is aware
                resolve(1);
            }
        });
    });
}

/**
 * @description queries for all records of an sobject and deletes them. Recursively calls itself to ensure sobjects are depopulated in the reverse order specified by order
 * @param {String} current - current sobject being depopulated
 * @param {Array} queue - list of remaining sobjects to be depopulated
 * @param {jsforce.Connection} conn - salesforce connection
 * @return {Promise} Indicates when all sobjects in queue have been depopulated
 */
function executeOrder66(current, queue, conn) {
    logger.log(logPath, logger.debug.INFO, `Depopulating object :: ${current}`);
    return query(conn, `SELECT Id FROM ${current}`).then((records) => {
        logger.log(logPath, logger.debug.INFO, `Retrieved ${records.length} records for ${current}`);
        let ids = [];
        for (let i = 0; i < records.length; i++) {
            ids.push(records[i].Id);
        }

        logger.log(logPath, logger.debug.INFO, `${current} record ids :: ${ids.toString()}`);

        return deleteRecords(conn, current, ids);
    }).then((res) => {
        logger.log(logPath, logger.debug.INFO, `Deleted ${res.successes} records from ${current}. ${res.failures} errors`);
        console.log(`Deleted ${res.successes} records from ${current}. ${res.failures} errors`);
        let next = queue.pop();
        if (next) {
            return executeOrder66(next, queue, conn);
        } else {
            return;
        }
    }).catch((err) => {
        logger.log(logPath, logger.debug.ERROR, `Error depopulating ${current} :: ${err}`);
        console.log(`Error depopulating ${current}. Check logs for details`);
        throw err;
    });
}

/**
 * @description queries for a set of records from salesforce
 * @param {jsforce.Connection} conn - salesforce connection
 * @param {String} queryString - soql query to execute
 * @return {Array[Sobject]} list of records returned by the soql query
 */
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

/**
 * @description 
 * @param {jsforce.Connection} conn - salesforce connection
 * @param {String} object - current sobject being depopulated
 * @param {Array} ids - record ids to delete
 * @return {Promise} resolves to an object that holds the number of successes and failures
 */
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