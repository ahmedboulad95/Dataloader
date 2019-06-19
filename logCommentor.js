const readline = require('readline');
const fs = require('fs');

let lines = [];

if (process.argv[2]) {

    const readInterface = readline.createInterface({
        input: fs.createReadStream(process.argv[2]),
        console: false
    });

    if(process.argv[3] === '-u') {
        readInterface.on('line', (line) => {
            if (line.trim().startsWith("//") && line.includes("console.log")) {
                line = line.substr(2);
            }
            lines.push(line);
        });
    
        readInterface.on('close', () => {
            let file = lines.join('\n');
            fs.writeFile(process.argv[2], file, (err) => {
                if (err) throw err;
            });
        });
    } else {
        readInterface.on('line', (line) => {
            if (line.trim().startsWith("console.log")) {
                line = '//' + line;
            }
            lines.push(line);
        });
    
        readInterface.on('close', () => {
            let file = lines.join('\n');
            fs.writeFile(process.argv[2], file, (err) => {
                if (err) throw err;
            });
        });
    }

    
} else {
    throw "Please provide an input file";
}