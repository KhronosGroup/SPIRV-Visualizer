// node getFiles.js
//
// Will walk this folder and grab all .spv files and put into a .json file
const fs = require("fs")
const path = require("path")

// Path that will be read from index.html
const relativePath = "tests";

const getAllFiles = function(dirPath, arrayOfFiles) {
    var files = fs.readdirSync(dirPath)

    arrayOfFiles = arrayOfFiles || []

    files.forEach(function(file) {
        if (fs.statSync(path.join(dirPath, file)).isDirectory()) {
            arrayOfFiles = getAllFiles(path.join(dirPath, file), arrayOfFiles)
        } else {
            if (file.endsWith(".spv")) {
                arrayOfFiles.push(path.join(dirPath.substring(dirPath.lastIndexOf(relativePath)), file))
            }
        }
    })

    return arrayOfFiles
}

const fileList = getAllFiles(__dirname);

var outFile = fs.createWriteStream(path.join(__dirname, 'tests.json'));
outFile.on('error', function(err) { console.log(err); });
outFile.write("{\"files\" : [\n");
fileList.forEach(function(file, index, array) {
    if (index === array.length - 1){
        outFile.write("\t\"" + file + "\"\n");
    } else {
        outFile.write("\t\"" + file + "\",\n");
    }
});
outFile.write("]}");
outFile.end();