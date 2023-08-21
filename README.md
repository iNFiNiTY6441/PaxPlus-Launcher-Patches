# PaxPlus-Launcher-Patches
Source files &amp; deployment scripts for the PaxPlus-Launcher game patches

##   Setup
### Clone Repo & Install dependencies
```
git clone https://github.com/iNFiNiTY6441/PaxPlus-Launcher-Patches.git
cd PaxPlus-Launcher-Patches
npm install
```

### Place UPK utility EXEs in `./utils` folder:

`decompress.exe` **Latest Version**
>From **Gildor's** ```Unreal Package Decompressor```  
https://www.gildor.org/downloads 


`patchUPK.exe` ❗ **Custom modified build by the PaxPlus team**
>Originally from **wghost's** ```UPKUtils```   
https://github.com/wghost/UPKUtils

##   Usage

### 📜 Customize `buildConfig.json`:
``` js
./src/buildConfig.json
{
    // Game install to test the patches on:
    "game": {

        "installDir": "C:/EXAMPLE/PATH/TO/Hawken-PC-Shipping", // Base game folder
        "iniDir": "C:/Users/<YOURNAME>/Documents/My Games/<HAWKEN_FOLDER>" // Game config inis
    },

    // Metadata to add to the final patch json
    "package": {

        "version": "0.0.0.0", // Unique patch package version, e.g. 1.2.3.4
        "name": "Lorem Ipsum" // Package / Version name, e.g. "Beta 3"
    }

}
```

### Run build script
```
node build
```

## ```OUTPUT``` 

### The finished & deployable patch JSON will be written to:
```
./src/out/gamePatch.json
```
