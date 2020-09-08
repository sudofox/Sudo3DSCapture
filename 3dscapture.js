/* Sudo3DSCapture */

const VID_3DS = 0x16D0;
const PID_3DS = 0x06A3;
const DEFAULT_CONFIGURATION = 1;
const CAPTURE_INTERFACE = 0;
const CAPTURE_ENDPOINT = 0x2;

const CMDOUT_CAPTURE_START = 0x40;

const FRAMEWIDTH = 240;
const FRAMEHEIGHT = 720;
// Size of frame data (3 bytes per pixel)
const FRAMESIZE = FRAMEWIDTH * FRAMEHEIGHT * 3;

// Debug stuff so we can fiddle with params live

// We can specify amount of extra data to pull (includes audio) after FRAMESIZE bytes
var extraDataSize = 256; // 2000;

// frameStartOffset - change where we start reading bytes from in the source data
// 0x45 seems to translate the frame to the correct position most of the time, though the colors are still off
// var frameStartOffset = 0x45; // this is decimal 69 
var frameStartOffset = 0;

// We can reduce the furthest offset we read with this.
// This is checked with:
// if ((readPos * 3) + 2 < result.data.byteLength - byteLengthOffset) {
// Setting this to 0x100 (256) wipes out the last line of rapidly shifting colors at the bottom which I think is audio data
// However, we are one line of pixels short - we are missing 720 bytes of frame data as the last line seems transparent.
// I think our missing data might be thrown in an additional bulk_in packet that we're not grabbing.  


// We seem to have fixed it but i want to preserve the above notes.

var byteLengthOffset = 0;

// If we change the order of the colors from RGB to BRG, we get the correct color. I think we have a weird issue with our offsets
// and if we solve those we won't have to shift the color order anymore

var rOrder = 0; // normally 0
var gOrder = 1; // normally 1
var bOrder = 2; // normally 2

// If we want to split the screen, we need to read 288000 (240*400*3) bytes for the top screen and 230400 bytes (240*320*3) for the bottom screen

var topScreenSize = 288000;
var bottomScreenSize = 230400;

// Choose how frequently we do the updates (you'll need to stop and start capture for it to take effect)

// 36 seems to minimize the glitchy frames
// 1000/35 is a bit under 30 FPS
// This is one more thing that should be fixable by fixing when we have incomplete frame data

var pollFrequency = 36;

// Split screen off by default

var doSplitScreen = true;

// Hack to skip render if previous data was < 518144
// This won't be needed once we can work out how to pull the entire frame data from multiple packets before rendering

var lastDataPacketTooSmall = false;

// De-asyncing thingy that doesn't seem to do much to help
var droppedFrames = 0;
var lastDrawCompleted = true;

var device, poller;

function pairUSB() {
    const filters = [{
        vendorId: VID_3DS,
        productId: 0x06A3
    }];

    navigator.usb.requestDevice({
        filters: filters
    }).then(usbDevice => {
        log("Connected: " + usbDevice.productName);
        device = usbDevice;
        return device.open(); // Begin a session.

    }).then(() => device.selectConfiguration(DEFAULT_CONFIGURATION)) // Select configuration #1 for the device.
        .then(() => device.claimInterface(CAPTURE_INTERFACE)) // Request exclusive control over interface
        .catch(error => {
            log(error);
        });
}

function queryUSB() {
    navigator.usb.getDevices().then(devices => {
        log("Total devices: " + devices.length);
        devices.forEach(device => {
            log("Product name: " + device.productName + ", serial number " + device.serialNumber);
        });
    });
}


function startCapture() {
    if (typeof device != "object") {
        pairUSB();
    }

    lastDrawCompleted = true;

    poller = setInterval(getFrame, pollFrequency);
}

function stopCapture() {
    clearInterval(poller);
    lastDrawCompleted = true;
}

function setFrameDelay(delay) {
    pollFrequency = delay;
}


function getBytesIn(endpoint, length) {
    return device.transferIn(endpoint, length)
        .then(result => { return result })
        .catch(error => { console.error("getBytesIn: " + error) });
}

async function getFrame() {

    if (!lastDrawCompleted) { return; }

    // Send 0x40 to request frame
    await device.controlTransferOut({
        requestType: 'vendor',
        recipient: 'device',
        request: CMDOUT_CAPTURE_START,
        value: 0x00,
        index: 0x00
    });

    let transferSize;
    let bytesNeeded = FRAMESIZE + extraDataSize;
    let frameData = new Uint8Array(bytesNeeded);
    let bytesIn = 0;

    //console.log("we need " + bytesNeeded);

    do {
        transferSize = ((FRAMESIZE - bytesIn) + 0x1ff) & ~0x1ff;
        const result = await getBytesIn(CAPTURE_ENDPOINT, transferSize)
            .catch(error => {
                console.error("getFrame inner do loop: " + error);
            });

        //console.log(result.data.byteLength);

        if (result.status == "ok") {

            for (i = 0; i < result.data.byteLength; i++) {
                frameData[bytesIn + i] = result.data.getUint8(i);
            }

            bytesIn = (bytesIn + result.data.byteLength);

        } else {
            // something didn't happen right
            console.error("error thingy");
        }

    //} while (bytesIn < bytesNeeded)

    } while (false);

    if (lastDrawCompleted) {
        await writeResult(frameData);
    }

}


async function writeResult(result) {

    lastDrawCompleted = false;

    //console.log(result);

    logStatus(result.byteLength + "(" + (result.byteLength / 3) + " out of 172800 pixels)");
    //console.log(result.byteLength);
    // Hacky if condition that doesn't solve the underlying issue of incomplete/misread frame 
    // lastDataPacketTooSmall just skips frames after we manage to pick up on the "remaing frame data" bulk_in sent
    // All this will be solved once we fix that.

    if (result.byteLength >= 518144 && !lastDataPacketTooSmall) {

        if (doSplitScreen) {

            var topScreen = document.getElementById("topscreen");
            var bottomScreen = document.getElementById("bottomscreen");

            var topContext = topScreen.getContext('2d');
            var bottomContext = bottomScreen.getContext('2d');

            //topContext.clearRect(0, 0, topScreen.width, topScreen.height);
            //bottomContext.clearRect(0, 0, bottomScreen.width, bottomScreen.height);


            // putImageData doesn't work with rotation so we're using a buffer canvas

            /*

            var bufferTop = document.createElement('canvas');
            var bufferBottom = document.createElement('canvas');

            bufferTop.width = bufferBottom.width = 240;
            bufferTop.height = 400;
            bufferBottom.height = 320;

            var bufferTopContext = bufferTop.getContext('2d');
            var bufferBottomContext = bufferBottom.getContext('2d');

            var topImage = bufferTopContext.createImageData(bufferTop.width, bufferTop.height);
            var bottomImage = bufferBottomContext.createImageData(bufferBottom.width, bufferBottom.height);
            */

            var topImage = topContext.createImageData(topScreen.width, topScreen.height);
            var bottomImage = bottomContext.createImageData(bottomScreen.width, bottomScreen.height);

            // foreach number of pixels
            for (var i = 0; i < 172800; i++) {
                readPos = i + frameStartOffset;
                //if ((readPos * 3) + 2 < result.byteLength - byteLengthOffset) {
                if (i < 96000) {
                    topImage.data[(4 * i) + 0] = result[(3 * readPos) + rOrder]; // ?? 0xFF;
                    topImage.data[(4 * i) + 1] = result[(3 * readPos) + gOrder]; // ?? 0xFF;
                    topImage.data[(4 * i) + 2] = result[(3 * readPos) + bOrder]; // ?? 0xFF;
                    topImage.data[(4 * i) + 3] = 0xFF;
                } else {
                    bottomOffset = i - 96000;
                    bottomImage.data[(4 * bottomOffset) + 0] = result[(3 * readPos) + rOrder]; // ?? 0xFF;
                    bottomImage.data[(4 * bottomOffset) + 1] = result[(3 * readPos) + gOrder]; // ?? 0xFF;
                    bottomImage.data[(4 * bottomOffset) + 2] = result[(3 * readPos) + bOrder]; // ?? 0xFF;
                    bottomImage.data[(4 * bottomOffset) + 3] = 0xFF;
                }
                // } else {
                //     console.log("still hit the condition");
                // }
            }

            /*
            bufferTopContext.putImageData(topImage, 0, 0);
            bufferBottomContext.putImageData(bottomImage, 0, 0);

            // For some reason this is just making things spin wildly, disabled for now

            topContext.rotate(-90);
            topContext.drawImage(bufferTop, 0, 0);

            bottomContext.rotate(-90);
            bottomContext.drawImage(bufferBottom, 0, 0);
            
            */

            topContext.putImageData(topImage, 0, 0);
            bottomContext.putImageData(bottomImage, 0, 0);


        } else {

            var canvas = document.getElementById("screen");
            var context = canvas.getContext('2d');

            var imageData = context.createImageData(canvas.width, canvas.height);

            // foreach number of pixels
            for (var i = 0; i < 172800; i++) {
                readPos = i + frameStartOffset;
                if ((readPos * 3) + 2 < result.byteLength - byteLengthOffset) {
                    imageData.data[(4 * i) + 0] = result[(3 * readPos) + rOrder] // ?? 0xFF;
                    imageData.data[(4 * i) + 1] = result[(3 * readPos) + gOrder] // ?? 0xFF;
                    imageData.data[(4 * i) + 2] = result[(3 * readPos) + bOrder] // ?? 0xFF;
                    imageData.data[(4 * i) + 3] = 0xFF;
                }
            }

            //for (var i = 518400; i < result.data.byteLength; i++) {
            //    pcmPlayer.feed(result.data.getUint8(i));
            //}

            context.putImageData(imageData, 0, 0);
        }


    } else if (result.data.byteLength >= 518144) {
        lastDataPacketTooSmall = false;
    } else {
        if (!lastDataPacketTooSmall) {
            // automatically adjust poll frequency, but only once
            if (result.data.byteLength > 0 && !(result.data.byteLength > 4000 && result.data.byteLength < 4500)) {
                document.getElementById("frame_delay_select").stepUp();
                document.getElementById("frame_delay_select").onchange();
            }
        } else {
            lastDataPacketTooSmall = true;
        }
    }

    lastDrawCompleted = true;
    droppedFrames = 0;

}

function toggleSplitScreen() {
    doSplitScreen = !doSplitScreen;

    if (doSplitScreen) {
        document.getElementById("canvas-container").style.display = "none";
        document.getElementById("split-canvas-container").style.display = "block";
    } else {
        document.getElementById("canvas-container").style.display = "block";
        document.getElementById("split-canvas-container").style.display = "none";
    }
}

// Debug and logging stuff

function log(string) {
    var pre = document.getElementById("output");
    pre.innerText = pre.innerText + string + "\n";
}

function logStatus(string) {
    var pre = document.getElementById("status");
    pre.innerText = string;
}

function buf2hex(buffer) { // buffer is an ArrayBuffer
    return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
}

function showTime() {
    return new Date().toLocaleString().replace(',', '');
}