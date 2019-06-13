const jsforce = require("jsforce");
const fs = require("fs");

// Establish a connection to Salesforce
var loginOptions = {
  loginUrl: "https://test.salesforce.com"
};
let conn = new jsforce.Connection(loginOptions);
conn.login(
  "aboulad@autoidinc.com",
  "Ahmdb_95_partialILZWV1mHuUZU6pv48WjzIQtV",
  function (err, userInfo) {
    if (err) console.log("Failed to login :: " + err);

    console.log("Access Token :: " + conn.accessToken);
    console.log("Instance URL :: " + conn.instanceUrl);
    console.log("User Id :: " + userInfo.id);

    // Grab the Loan__c object metadata
    conn.sobject("Loan__c").describe(function (err, metadata) {
      if (err) console.log("Error :: " + err);

      // Write the metadata out to a file for easy viewing
      /*fs.writeFile('response.json', JSON.stringify(metadata), function(err) {
            if(err) console.log("Error writing file :: " + err);
        });*/

      // Objects that we don't need to insert
      const omitObjects = ["Group", "User", "RecordType"];

      let relObjectsMap = []; // Map for the related object metadata, indexed by field name
      let relObjectRecordIds = []; // List that contains a list of record ids for each related object
      let lookupObjects = {};
      //let lookupFields = [];

      // Loop through all the Loan object fields
      metadata.fields.forEach(element => {
        // Check if field is a lookup
        if (element.referenceTo.length > 0) {
          // Field could reference multiple objects
          element.referenceTo.forEach(objectName => {
            console.log(objectName);
            // Only add object if it hasn't been added already and it is not one of the omitted objects
            if (
              /*lookupObjects.indexOf(objectName) === -1 &&*/
              omitObjects.indexOf(objectName) === -1
            ) {
              //lookupFields.push(element.name);
              //console.log("Element :: " + element.name);
              if (lookupObjects[objectName])
                lookupObjects[objectName].fields.push(element.name);
              else {
                lookupObjects[objectName] = {};
                lookupObjects[objectName].fields = [];
                lookupObjects[objectName].fields.push(element.name);
              }
            }
          });
        }
      });

      console.log("Lookup Objects :: " + JSON.stringify(lookupObjects));

      // Dynamically build the Loan query
      let queryString = "SELECT ";
      let fields = [];
      metadata.fields.forEach((element) => {
        fields.push(element.name);
      });

      queryString += fields.join(",");

      queryString += " FROM Loan__c LIMIT 20";

      let records = [];
      let query = conn.query(queryString)
        .on("record", (record) => {
          //console.log(record);
          records.push(record);
        })
        .on("end", () => {
          // Write loans to a file
          /*fs.writeFile(
            "loans.json",
            JSON.stringify(records),
            function (err) {
              if (err) console.log("Error writing file :: " + err);
            }
          );*/


          getMetadata(lookupObjects).then((response) => {
            lookupObjects = response;
            /*fs.writeFile(
              "lookupObjects.json",
              JSON.stringify(lookupObjects),
              function (err) {
                if (err) console.log("Error writing file :: " + err);
              }
            );*/
          });

          relObjectsMap.forEach((relObject) => {
            let recIds = [];
            records.forEach((loan) => {
              recIds.push(loan[relObject.lookupName]);
            });
            relObjectRecordIds.push(recIds);
          });

          //console.log("Related Records :: " + relObjectRecordIds);
          //relObjectRecordIds.forEach((recordIds) => {

          //});
        })
        .on("error", (err) => {
          console.log("Error :: " + err);
        })
        .run({ autoFetch: true, maxFetch: 20 });

      //console.log("\n");
      //console.log(lookupObjects);
    });
  }
);

function getMetadata(lookupObjects) {
  return new Promise((resolve, reject) => {
    let relObjectsMap = lookupObjects;
    let keys = Object.keys(relObjectsMap)

    let counter = 0;
    for (let i = 0; i < keys.length; i++) {
      //lookupObjects.forEach((obj) => {
      // Fetch the metadata for each related object
      
      conn.sobject(keys[i]).describe((err, relObjMetadata) => {
        if (err) reject(err);
        //console.log((relObjMetadata) ? "" : "Undefined for " + keys[i]);
  
        // Write the metadata out to a file
        /*let fileName = objectName + '.json';
                    fs.writeFile(fileName, JSON.stringify(relObjMetadata), (err) => {
                        if(err) console.log('Error writing file :: ' + err);
                    });*/
  
        // Add metadata to related objects map
        relObjectsMap[keys[i]].metadata = relObjMetadata;

        // Return the map if on the last element
        if(counter === keys.length - 1) {
          resolve(relObjectsMap);
        }
        counter++;
      });
    }
  })
}