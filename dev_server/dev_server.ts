#!/usr/bin/env node

import { randomBytes } from "crypto";
import { WebSocket, WebSocketServer } from "ws";
import { EmulatorStatus, PineClientPCSX2 } from "emu-pine-client";
import { IncomingMessage } from "http";

const url_string =  randomBytes(20).toString('hex');
let port = 27634;
for(let i = 0; i < process.argv.length; i++) {
	if(process.argv[i] === "--port") {
		i++;
		port = +process.argv[i] || port;
	}
}

const client = new PineClientPCSX2();

const wss = new WebSocketServer({port, verifyClient: (info: { origin: string, secure: boolean, req: IncomingMessage }) => {
	return info.req.url && info.req.url.includes(url_string);
}});
let curr_ws : WebSocket|undefined;
let file_needed : string|undefined = undefined;
let file_needed_callback : ((buf : Buffer) => void)|undefined = undefined;
curr_ws = undefined as WebSocket|undefined;

wss.on("listening", () => {
	console.log(`Listening at ws://localhost:${port}/${url_string}\n`);
});
wss.on("connection", ws => {
	if(curr_ws) curr_ws.close();
	curr_ws = ws;
	if(file_needed) {
		ws.send(JSON.stringify({"request_file": file_needed}));
	}
	ws.on("message", (data, is_binary) => {
		console.log(is_binary);
		if(!is_binary && data instanceof Buffer) {
			let json = JSON.parse(data.toString("utf8"));
			console.log(json.file_data_id + " received");
			if(json.file_data_id && json.file_data_id === file_needed && file_needed_callback) {
				console.log("matches");
				let data_str = json.file_data as string;
				let data = Buffer.from(data_str.substring(data_str.indexOf(";base64,") + 8), "base64");
				file_needed_callback(data);
				file_needed_callback = undefined;
				file_needed = undefined;
			}
		}
	});
});

function setupHook() {
	console.log("Installing hook");
	const code = [
		0x3C020200, // lui v0,0x0200
		0x24428000, // addiu v0,-0x8000
		0x8C830000, // lw v1,(a0)
		0xAC430000, // sw v1,(v0)	
		0xAC400004, // sw zero,0x4(v0)
		0xAC5F0008, // sw ra,0x8(v0)
		0xAC45000C, // sw a1,0xC(v0)
		// loop:
		0x8C440004, // lw a0,0x4(v0)
		0x1080FFFE, // beqz a0, loop
		0xAC40004c, // sw zero,0x4c(v0)
		0x8C460008, // lw a2,0x8(v0)
		0x8C64001C, // lw a0,0x1C(v1)
		0x8C65002C, // lw a1,0x2C(v1)
		0x00C00008, // jr a2
		0x00000000  // nop
	];
	
	for(let i = 0; i < code.length; i++) {
		client.write32(0x1ff8010+i*4, code[i]);
	}

	client.write32(0x25e810, 0x087FE004); // j 0x1FF8010
	client.write32(0x25e814, 0x24050000); // li a1,0x0

	client.write32(0x25e8e8, 0x087FE004); // j 0x1FF8010
	client.write32(0x25e8ec, 0x24050000); // li a1,0x0

	client.write32(0x25e7ac, 0x24020003); // li v0,0x3
}

async function removeHook() {
	let is_hooked_1 = await client.read32(0x25e810) === 0x087FE004;
	if(is_hooked_1) {
		client.write32(0x25e810, 0x27BDFEC0);
		await client.write32(0x25e814, 0x7FB00130);
	}
	let is_hooked_2 = await client.read32(0x25e8e8) === 0x087FE004;
	if(is_hooked_2) {
		client.write32(0x25e8e8, 0x27BDFEC0);
		await client.write32(0x25e8ec, 0x7FB00130);
		client.write32(0x25e7ac, 0x24020002);
	}
}

function file_request(name : string) : Promise<Buffer> {
	if(curr_ws) curr_ws.send(JSON.stringify({"request_file": name}));
	return new Promise(resolve => {
		file_needed = name;
		file_needed_callback = resolve;
	});
}

(async () => {
	setupHook();
	while(true) {
		await new Promise(resolve => setTimeout(resolve, 16));
		if(await client.getStatus() === EmulatorStatus.Shutdown) {
			continue;
		}
		
		if(await client.read32(0x25e810) === 0x27BDFEC0) setupHook();

		let struct = await client.read32(0x1ff8000);
		if(struct) {
			let [index, targetAddr, maxSize, isAsync, callback] = await Promise.all([
				client.read32(struct + 0x10),
				client.read32(struct + 0x20),
				client.read32(struct + 0x24),
				client.read32(0x1ff800C),
				client.read32(struct+0x18)
			]);
			console.log(`Read file ${index} to address ${targetAddr.toString(16)}, size limit is ${maxSize}, async=${isAsync}, callback=${callback.toString(16)}`);
			let buf = await file_request(`GAMEFILE:${index}`);
			if(buf.length > maxSize) {
				console.log("Warning - buffer size exceeded! File is " + buf.length + " while max size is " + maxSize);
			}
			await client.writeBlock(targetAddr, buf);
			console.log(buf.length + " bytes loaded\n");

			if(isAsync) {
				client.write32(0x1ff8008, callback);
			}
			client.write32(0x42c724, Math.ceil(buf.length / 2048) * 2048);
			client.write32(struct+0x2c, Math.ceil(buf.length / 2048) * 2048);
			//client.write32(struct, 0);
			client.write32(0x39be34, 1);
			client.write32(0x39be38, 1);
			// callback = +18 with params +1c and +2c
			client.write32(0x1ff8000, 0);
			client.write32(0x1ff8004, 1);
		}
	}
})();

process.on("SIGINT", () => {
	console.log("Removing hooks");
	removeHook().then(() => {
		process.exit();
	}, () => {
		process.exit(1);
	});
})
