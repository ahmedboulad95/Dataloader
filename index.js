const jsforce = require('jsforce');
const fs = require('fs');


var loginOptions = {
    loginUrl : 'https://test.salesforce.com'
}
let conn = new jsforce.Connection(loginOptions);
conn.login('aboulad@autoidinc.com', 'Ahmdb_95_partialILZWV1mHuUZU6pv48WjzIQtV', function(err, userInfo) {
    if(err) console.log('Failed to login :: ' + err);

    console.log('Access Token :: ' + conn.accessToken);
    console.log('Instance URL :: ' + conn.instanceUrl);
    console.log('User Id :: ' + userInfo.id);

    
    

    conn.describe('Loan__c', function(err, metadata) {
        if(err) console.log("Error :: " + err);

        /*
        fs.writeFile('response.json', JSON.stringify(metadata), function(err) {
            if(err) console.log("Error writing file :: " + err);
        });
        */
        let queryString = 'SELECT ';
        let fields = [];
        metadata.fields.forEach(function(element) {
            fields.push(element.name);
        });

        queryString += fields.join(',');

        queryString += ' FROM Loan__c LIMIT 20';

        let records = [];
        let query = conn.query(queryString)
            .on("record", function(record) {
                console.log(record);
                records.push(record);
            })
            .on("end", function() {
                fs.writeFile('loans.json', JSON.stringify(records), function(err) {
                    if(err) console.log("Error writing file :: " + err);
                });
            })
            .on("error", function(err) {
                console.log("Error :: " + err);
            })
            .run({autoFetch : true, maxFetch : 20});

    });
});
