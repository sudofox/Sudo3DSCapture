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
var extraDataSize = 0; // 2000;

// frameStartOffset - change where we start reading bytes from in the source data
// 0x45 seems to translate the frame to the correct position most of the time, though the colors are still off
var frameStartOffset = 0x45; // this is decimal 69 

// We can reduce the furthest offset we read with this.
// This is checked with:
// if ((readPos * 3) + 2 < result.data.byteLength - byteLengthOffset) {
// Setting this to 0x100 (256) wipes out the last line of rapidly shifting colors at the bottom which I think is audio data
// However, we are one line of pixels short - we are missing 720 bytes of frame data as the last line seems transparent.
// I think our missing data might be thrown in an additional bulk_in packet that we're not grabbing.  
var byteLengthOffset = 0x100; // this is decimal 256

// If we change the order of the colors from RGB to BRG, we get the correct color. I think we have a weird issue with our offsets
// and if we solve those we won't have to shift the color order anymore

var rOrder = 1; // normally 0
var gOrder = 2; // normally 1
var bOrder = 0; // normally 2

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

    poller = setInterval(getFrame, 30);
}

function getFrame() {
    // Send 0x40 to request frame
    device.controlTransferOut({
        requestType: 'vendor',
        recipient: 'device',
        request: CMDOUT_CAPTURE_START,
        value: 0x00,
        index: 0x00
    }).then(() => device.transferIn(CAPTURE_ENDPOINT, (FRAMESIZE + extraDataSize)))
        .then(result => {
            writeResult(result);
        }).catch(error => {
            console.error(error);
        });
}


function writeResult(result) {

    logStatus(result.data.byteLength + "(" + (result.data.byteLength / 3) + " out of 172800 pixels)");
    
    // Hacky if condition that doesn't solve the underlying issue of incomplete/misread frame data
    if (result.data.byteLength >= 518144) {

        var canvas = document.getElementById("screen");
        var context = canvas.getContext('2d');
        //	log(typeof rgbaBuf);
        var imageData = context.createImageData(canvas.width, canvas.height);


        for (var i = 0; i < 172800; i++) {
            readPos = i + frameStartOffset;
            if ((readPos * 3) + 2 < result.data.byteLength - byteLengthOffset) {
                imageData.data[(4 * i) + 0] = result.data.getUint8((3 * readPos) + rOrder) // ?? 0xFF;
                imageData.data[(4 * i) + 1] = result.data.getUint8((3 * readPos) + gOrder) // ?? 0xFF;
                imageData.data[(4 * i) + 2] = result.data.getUint8((3 * readPos) + bOrder) // ?? 0xFF;
                imageData.data[(4 * i) + 3] = 0xFF;
            }
        }

        //for (var i = 518400; i < result.data.byteLength; i++) {
        //    pcmPlayer.feed(result.data.getUint8(i));
        //}

        context.putImageData(imageData, 0, 0);
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