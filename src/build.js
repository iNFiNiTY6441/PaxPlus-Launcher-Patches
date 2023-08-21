const fs = require('fs');
const path = require('path');
const util = require('util');
const crypto = require('crypto');
const ini = require('ini');

const open = util.promisify(fs.open);
const stat = util.promisify(fs.stat);
const read = util.promisify(fs.read);
const write = util.promisify(fs.write);
const close = util.promisify(fs.close);

const exec = util.promisify(require('child_process').exec);

// Tool exe paths
const UPK_DECOMPRESSOR_TOOL= "../utils/decompress.exe";
const UPK_PATCH_TOOL= "../utils/PatchUPK.exe";

// Game file directories
var GAME_UPK_DIR = null;
var GAME_INI_DIR = null;

// Build config 
var buildConfig = null;

// Patch storage objects
var fileRequirements = {};
var iniPatches = {};
var upkPatches = {};
var binaryPatches = {};
var mechSetupPatches = {};

// Object for the final patch json
var patchPackage = {};

////////////////////////////////////////////////////////////////////////////////
//   UTIL FUNCTIONS                                                           //
////////////////////////////////////////////////////////////////////////////////
/**
 * Creates a backup file for a given file
 * @async
 * @param {String} filePath File to back up
 * @param {*} backupFilePath Path to write the backup to
 * @returns 
 */
async function backupFile( filePath, backupFilePath ) {

    return await fs.copyFileSync( filePath, backupFilePath); 
}

/**
 * Restores the original file from a .backup file
 * @async
 * @param {String} filePath Backup file to restore 
 * @returns 
 */
async function restoreFileFromBackup( filePath ) {

    return await fs.copyFileSync( filePath, filePath.split(".backup")[0] );
}

/**
 * Returns the MD5 checksum for a given file
 * @param {String} filePath File to hash 
 * @returns MD5 Checksum of file
 */
function getHash( filePath ) {
    
    let file = fs.readFileSync( filePath );

    let hash = crypto.createHash("md5");
    hash.setEncoding('hex');
    hash.write( file )
    hash.end();
    return hash.read();
}

/**
 * Decompresses a UPK file using gildors package decompressor
 * @async
 * @param {String} compressedFilePath Path to the compressed file
 * @param {String} decompressedFilePath Path to write the uncompressed file to 
 * @param {Boolean} replaceOriginal Overwrite the compressed file with the uncompressed one
 * @returns Decompress command output
 */
async function decompressUPK( compressedFilePath, decompressedFilePath, replaceOriginal = true ) {

    const decompressorTool = path.basename(UPK_DECOMPRESSOR_TOOL);
    const decompressorDirectory = path.dirname(UPK_DECOMPRESSOR_TOOL);

    let decompressCommand = `${decompressorTool} "${compressedFilePath}" -out="${path.dirname(decompressedFilePath)}"`;

    let output = await exec( decompressCommand, { cwd: decompressorDirectory } ).catch( err => { throw new Error("Decompression failure.", { cause: err })});

    if ( replaceOriginal === true ) await fs.renameSync( decompressedFilePath, compressedFilePath );

    return output;
}

/**
 * Applies a UPKUtils patch from a patch file
 * @async
 * @param {String} upkDirectory Directory containing the upk files
 * @param {String} patchFilePath File containing the patch operations to perform
 * @returns Patch command output
 */
async function patchUPK( upkDirectory, patchFilePath ) {

    const patcherTool = path.basename(UPK_PATCH_TOOL);
    const patcherDirectory = path.dirname(UPK_PATCH_TOOL);

    const patchCommand = `${patcherTool} ${patchFilePath} "${upkDirectory}"`

    let output = await exec( patchCommand, { cwd: patcherDirectory } ).catch( err => { throw new Error("SHIT", { cause: err })});
    return output;
}

/**
 * Sets a key to a specific value within a parsed ini object
 * 
 * @param {Object} parsedIni Parsed ini object 
 * @param {*} section Section of the ini
 * @param {*} key Key of the ini
 * @param {*} value Value to set the key to
 * @returns If the key already existed or had to be created
 */
function setIniValue( parsedIni, section, key, value) {
    const sectionParts = section.split('.');
    let currentSection = parsedIni;

    let exists = true;

    for (const sectionPart of sectionParts) {
        if (!currentSection[sectionPart]) {
            exists = false;
            currentSection[sectionPart] = {};
        }
        currentSection = currentSection[sectionPart];
    }

    if ( !currentSection[key] ) exists = false;
    currentSection[key] = value;
    return exists;
}

////////////////////////////////////////////////////////////////////////////////
//   PATCH INGEST FUNCTIONS                                                   //
////////////////////////////////////////////////////////////////////////////////
/**
 * Loads all binary patches from the source files
 * @async
 */
async function ingestBinaryPatches(){


    let binFileFolders = fs.readdirSync( "./patches/bin" );

    // Each binfile folder
    for ( let i in binFileFolders ) {

        let binFolderPath = path.join( "patches","bin", binFileFolders[i] );

        let binFilePatchFiles = fs.readdirSync( binFolderPath );
        binFilePatchFiles.splice( binFilePatchFiles.indexOf('.fileinfo.json'), 1 );

        let binFileInfo = JSON.parse( fs.readFileSync( path.join( binFolderPath, '.fileinfo.json' ) ) );

        fileRequirements[ binFileFolders[i] ] = binFileInfo;

        if ( !binaryPatches[ binFileFolders[i] ] ) binaryPatches[ binFileFolders[i] ] = {};

        binaryPatches[ binFileFolders[i] ].originalSize = binFileInfo.originalPackedSize;
        binaryPatches[ binFileFolders[i] ].requiredHash = binFileInfo.hash_original;
        binaryPatches[ binFileFolders[i] ].patches = {};

        // Each patch file inside the binfile folder
        for ( let j in binFilePatchFiles ) {

            let patchFilePath = path.join( binFolderPath, binFilePatchFiles[j] );
            let fileName = path.basename( patchFilePath, '.js');

            let patchFile = require( "./"+patchFilePath );


            if ( !binaryPatches[ binFileFolders[i] ].patches[ fileName ] ) {
                binaryPatches[ binFileFolders[i] ].patches[ fileName ] = patchFile.replacements
            } else {
                binaryPatches[ binFileFolders[i] ].patches[ fileName ] = binaryPatches[ binFileFolders[i] ].patches[ fileName ].concat( patchFile.replacements );
            }            

        }

    }

}

/**
 * Loads all ini patches from the source files.
 * @async
 */
async function ingestIniPatches(){

    let iniFileFolders = fs.readdirSync( "./patches/ini" );

    for ( let i in iniFileFolders ) {

        let iniFolderPath = path.join( "patches","ini", iniFileFolders[i] );

        let iniFilePatchFiles = fs.readdirSync( iniFolderPath );

        iniPatches[ iniFileFolders[i] ] = {};


        for ( let j in iniFilePatchFiles ) {

            let fileName = path.basename( iniFilePatchFiles[j] );
            
            let data = JSON.parse( fs.readFileSync( path.join( "patches","ini", iniFileFolders[i], iniFilePatchFiles[j] ) ) );

            Object.assign( iniPatches[ iniFileFolders[i] ], data );
        }


    }
}

/**
 * Loads all upk patches from the source files
 * @async
 */
function ingestUPKPatches() {

    let patchFilesDir = path.join("patches","upk");

    let UPKpatchFiles = fs.readdirSync( "./patches/upk" );

    for ( const i in UPKpatchFiles ) {

        upkPatches[ UPKpatchFiles[i] ] = fs.readFileSync( path.join( patchFilesDir, UPKpatchFiles[i] ), 'utf-8' );
    }
    
}

/**
 * Loads all mechsetup configs from the source files
 * @async
 */
async function ingestMechSetupPatches(){

    let mechSetupFiles = fs.readdirSync( "./patches/mechsetup" );

    // Each mechsetup files
    for ( let i in mechSetupFiles ) {

        let data = JSON.parse( fs.readFileSync( path.join( "patches", "mechsetup", mechSetupFiles[i] ), 'utf-8') );

        // Merge into mechsetup object
        Object.assign( mechSetupPatches, data );
    }

}

////////////////////////////////////////////////////////////////////////////////
//   PATCHING FUNCTIONS                                                       //
////////////////////////////////////////////////////////////////////////////////
/**
 * Tests & applies all binary patches from the source files
 * @async
 */
async function applyPatches_binary() {


    let patchErrors = 0;
    let patchTotal = 0;

    for ( let patchTargetFile in binaryPatches ) {

        let patchInfo = binaryPatches[ patchTargetFile ];
        let patchCategories = binaryPatches[ patchTargetFile ].patches;

        // console.log(patchInfo)

        let patchOperationObject = {

            operationType: "binaryFilePatcher",
            filePath: "./HawkenGame/CookedPC/"+patchTargetFile,
            fileOriginalSize: patchInfo.originalSize,
            requiredHash: patchInfo.requiredHash,
            actions: []

        };


        let patchTargetFilePath = path.join( GAME_UPK_DIR, patchTargetFile );
        

        if ( !fs.existsSync( patchTargetFilePath ) ) throw new Error("Game file not found!")


        let fileInfo = await stat( patchTargetFilePath );

        console.log("")
        

        if ( fileInfo.size != patchOperationObject.fileOriginalSize ) {

            // RESTORE FROM EXISTING BACKUP
            if ( fs.existsSync( `${patchTargetFilePath}.backup` ) ) {

                console.log(`       ${patchTargetFile} [RESTORE FROM BACKUP]`);
                fs.copyFileSync( `${patchTargetFilePath}.backup`, patchTargetFilePath );

            } else {

                console.log(`       ${patchTargetFile} [FAIL] No files or backups found.`);
                throw new Error("No original game file found! (No backup eihter)")
            }

        } 

        // CREATE BACKUP
        console.log(`       ${patchTargetFile} [CREATE BACKUP FILE]`);

        await backupFile( patchTargetFilePath, `${patchTargetFilePath}.backup` );

        console.log(`       ${patchTargetFile} [BACKUP DONE]`);
        console.log("");


        console.log(`       ${patchTargetFile} [DECOMPRESS UPK]`);
        await decompressUPK( patchTargetFilePath, path.join( path.dirname(patchTargetFilePath), "..", "unpacked", patchTargetFile ), true );

        console.log(`       ${patchTargetFile} [DECOMPRESS DONE]`);
        console.log("");
        
        let fileDescriptor = await open( path.join( GAME_UPK_DIR, patchTargetFile ), 'r+');


        console.log("       BINARY PATCHING___________________________")
        console.log("")
        

        for ( let patchCategory in patchCategories ) {

            let patchActions = binaryPatches[ patchTargetFile ].patches[ patchCategory ];

            for ( let i in patchActions ) {

                patchTotal++;

                let patchAction = {};

                let offsetHexPadded = "0x"+patchActions[i].offset.toString(16).padStart(8,'0')//.toUpperCase();

                let byteArrayFrom = Buffer.from( patchActions[i].from ).toString("hex").split(/(.{2})/).filter(O=>O).map(i => '0x' + i);
                let byteArrayTo = Buffer.from( patchActions[i].to ).toString("hex").split(/(.{2})/).filter(O=>O).map(i => '0x' + i);

                patchAction.offset = offsetHexPadded;
                patchAction.from = byteArrayFrom;
                patchAction.to = byteArrayTo;

                patchAction.comment = "("+patchCategory+") "+offsetHexPadded;

                const buffer = Buffer.alloc(patchAction.to.length);
                await read(fileDescriptor, buffer, 0, patchAction.to.length, patchActions[i].offset );

                let byteArrayActual = buffer.toString("hex").split(/(.{2})/).filter(O=>O).map(i => '0x' + i);

                if (!buffer.equals( Buffer.from(patchActions[i].from) ) ) {

                    console.log("\r\n")
                    console.log("-------------------------------------------------------------\r\n");
                    console.log( ("("+patchCategory+") ").padEnd(12," ") +patchTargetFile+":"+offsetHexPadded+" > [ FAIL ] ( Mismatch )\r\n");


                    console.log(" Expected: ");
                    console.log( byteArrayFrom );
                    console.log("\r\n Got:")
                    console.log( byteArrayActual )
                    console.log("\r\n-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_\r\n\r\n");
                    patchErrors++;
                    
                } else {
                    console.log( "       "+("("+patchCategory+") ").padEnd(12," ") +patchTargetFile+":"+offsetHexPadded+" > [ PASS ]");
                    
                    patchOperationObject.actions.push( patchAction );
                }

                await write(fileDescriptor, Buffer.from(patchAction.to), 0, patchAction.to.length, patchActions[i].offset);
                
            }

        }

        if (fileDescriptor) close(fileDescriptor);

        patchOperationObject.fileOriginalSize = binaryPatches[ patchTargetFile ].originalSize;
        patchOperationObject.requiredHash = binaryPatches[ patchTargetFile ].requiredHash;

        patchOperationObject.targetHash = getHash( patchTargetFilePath );
        console.log("")
        console.log("           Patched Hash: "+getHash( patchTargetFilePath ) );

        patchPackage.operations.push( patchOperationObject );

    }

    console.log("");
    console.log("        Results:");
    console.log("");
    console.log("           Total patches: " + patchTotal );
    console.log("           Errors / Skipped: "+patchErrors);
    console.log("");

}

/**
 * Combines all ingested upk patches, applies the patch with UPKUtils, and writes them into the patchPackage object
 * @async
 */
async function applyPatches_UPK(){

    console.log("       UPK PATCHING___________________________");
    console.log("")
    console.log("       Building patchfile from: ")
    console.log("");
    
    // All UPKUtils patchdata can be merged into one text file, the exe handles opening the different upk files
    let combinedPatchData = "";

    // Each queued txt patch file
    for ( let patch in upkPatches ) {

        console.log("       "+patch);
        
        // Add to combined patch text 
        combinedPatchData += "\r\n\r\n"+upkPatches[patch];
    }

    console.log("");
    console.log("       Merging UPKPatches...");

    // Add UPKUtils patch operation
    patchPackage.operations.push({

        operationType: "upkUtilsPatcher",
        data: combinedPatchData
    });

    // Write all combined operation text into a file, as the exe needs to read from a patch file
    await fs.writeFileSync( "./out/temp_upkutils_patch.txt", combinedPatchData );
    console.log("       MERGED TO: ./out/temp_upkutils_patch.txt\r\n");

    // Run the patcher
    let output = await patchUPK( GAME_UPK_DIR, path.join(__dirname,"out","temp_upkutils_patch.txt") );    

    // Properly format stdout for debug, nothing more
    for ( let line in output.stdout.split("\r\n") ) {
        
        let log = "       "+output.stdout.split("\r\n")[line];
        if (output.stdout.split("\r\n")[line].indexOf("Opening package") >= 0 ){

            log = "\r\n       "+output.stdout.split("\r\n")[line];
        }
        console.log(log);
    }

    console.log("       DONE!");
}


/**
 * Writes all mechsetup patches to the patchPackage
 * @async
 */
async function applyPatches_mechSetup(){

    patchPackage.operations.push({

        operationType: "mechsetupPatcher",
        data: JSON.stringify( mechSetupPatches )
    });
}

/**
 * Applies all ingested ini patches & packages them into the patchPackage object
 * @async
 */
async function applyPatches_Ini(){

    console.log("");
    console.log("       INI PATCHING___________________________");
    console.log("")

    // Loop through all queued ini patches
    for ( let iniFileName in iniPatches ) {

        console.log("")
        console.log("       "+iniFileName);
        console.log("");

        // Each patch is per ini file, create a new operation object per file
        let patchOperationObject = {

            operationType: "iniFilePatcher",
            file: iniFileName,
            actions: []

        };


        let filePath = path.join( GAME_INI_DIR, iniFileName );

        // "Default..." ini files are stored in the base game directory, change accordingly
        if ( iniFileName.startsWith("Default") ) filePath = path.join( buildConfig.game.installDir, "HawkenGame", "Config", iniFileName );
        

        let iniFile = ini.parse( fs.readFileSync( filePath, 'utf-8' ) );

        // Each key in the ini patch config is a section within the ini file
        for ( let iniSection in iniPatches[iniFileName] ) {

            // Each subsequent key within that section is the key of the ini key-value pair
            for ( let iniKey in iniPatches[iniFileName][iniSection] ) {

                // setIniValue will return whether the key-value pair had to be created or if it was just set to the new value
                let exists = await setIniValue( iniFile, iniSection, iniKey, iniPatches[iniFileName][iniSection][iniKey]);

                // Push key-value modification as an action for the patch operation for this ini file
                patchOperationObject.actions.push({
                    section: iniSection,
                    key: iniKey,
                    value: iniPatches[iniFileName][iniSection][iniKey]
                });

                // Debug log accordingly
                let debug_status = exists == true ? "[SETVAL]: " : "[CREATE]: ";
                console.log("          "+debug_status+iniKey+" = "+iniPatches[iniFileName][iniSection][iniKey]);
            }
        }

        // Add fininshed operation object to the patch package
        patchPackage.operations.push( patchOperationObject );

        // Write changes to ini file
        console.log("\r\n       File saved.")
        fs.writeFileSync( filePath, ini.stringify( iniFile ) );

    }

}

////////////////////////////////////////////////////////////////////////////////
//   MAIN FUNCTION                                                            //
////////////////////////////////////////////////////////////////////////////////

/**
 * Does all the things. Loads all patches from source, applies them & packages them into the patch json
 * @async
 */
async function buildRemotePackage() {

    // Load buildConfig
    if ( buildConfig === null ) {

        let buildConfigFile = fs.readFileSync("./buildConfig.json");
        buildConfig = JSON.parse( buildConfigFile );
    }

    // Malformed buildConfig
    if ( !buildConfig.game ) throw new Error("[CFG_ERROR]: buildConfig.json has no 'game' section! ");
    if ( !buildConfig.package ) throw new Error("[CFG_ERROR]: buildConfig.json has no 'package' section! ");

    // MISSING CONFIG VALUES
    if ( !buildConfig.game.installDir || buildConfig.game.installDir.length === 0 ) throw new Error("[CFG_ERROR]: buildConfig.json is missing game install path!");
    if ( !buildConfig.game.iniDir || buildConfig.game.iniDir.length === 0 ) throw new Error("[CFG_ERROR]: buildConfig.json is missing game ini path!");

    // INVALID CONFIG VALUES
    if ( !fs.existsSync( buildConfig.game.installDir ) ) throw new Error("[CFG_ERROR]: Invalid game install directory!");
    if ( !fs.existsSync( buildConfig.game.iniDir ) ) throw new Error("[CFG_ERROR]: Invalid game ini directory!");

    // Prepare patchPackage
    patchPackage = {
        meta: buildConfig.package,
        operations: []
    };

    // Set relevant directories
    GAME_UPK_DIR = path.join( buildConfig.game.installDir, "HawkenGame", "CookedPC" );
    GAME_INI_DIR = path.join( buildConfig.game.iniDir, "HawkenGame", "Config" );


    // BEGIN BUILD
    console.clear();
    console.log("");
    console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
    console.log("      GAMEPATCH BUILD started at "+ new Date() );
    console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
    console.log("");
    console.log("       ------------------------------");
    console.log("       "+patchPackage.meta.version );
    console.log("       "+patchPackage.meta.name );
    console.log("       ------------------------------");
    console.log("");

    // Ingest all patches from source files
    await ingestIniPatches();
    console.log(`       ${Object.keys(iniPatches).length} Ini patch files.`);

    await ingestMechSetupPatches();
    console.log(`       ${Object.keys(mechSetupPatches).length} mech setups.`);

    await ingestBinaryPatches();
    console.log(`       ${Object.keys(binaryPatches).length} binary patches.`);

    await ingestUPKPatches();
    console.log(`       ${Object.keys(upkPatches).length} upk patches.`);
    
    console.log("");

    // Test & bundle patches in the most logical order
    await applyPatches_binary();
    await applyPatches_UPK();
    await applyPatches_mechSetup();
    await applyPatches_Ini();

    // Write patch package to file
    fs.writeFileSync( './out/gamePatch.json', JSON.stringify( patchPackage ) );
}


buildRemotePackage();

