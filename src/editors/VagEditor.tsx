import { Box, Button } from "@mui/material";
import { fileOpen } from "browser-fs-access";
import { VagAudio } from "ntdf-modding-toolkit";
import { useEffect, useMemo, useState } from "react";
import { AppCallbacks } from "../App";
import { audio_ctx } from "../audio_context";
import { GamefilePath } from "../path";
import { to_wav } from "../to_wav";

export function VagEditor(props : {
	vag : VagAudio,
	callbacks : AppCallbacks,
	path : GamefilePath<Blob>
}) {
	let buffer = useMemo(() => {
		let buf = audio_ctx.createBuffer(1, props.vag.data.length, props.vag.sample_rate);
		buf.copyToChannel(props.vag.data, 0);
		return buf;
	}, [props.vag]);
	const wav = useMemo(() => new Blob([to_wav(buffer)], {type: "audio/wav"}), [buffer]);
	const [src, set_src] = useState<string|undefined>(undefined);
	useEffect(() => {
		let url = URL.createObjectURL(wav);
		set_src(url);
		return () => {
			URL.revokeObjectURL(url);
		}
	}, [wav]);

	console.log(buffer);
	return (
		<Box>
			<Box sx={{m:2}}><audio src={src} controls/></Box>
			<Button sx={{m:2}} onClick={async () => {
				let file = await fileOpen({
					mimeTypes: ["audio/*"]
				});
				let buffer = await audio_ctx.decodeAudioData(await file.arrayBuffer());
				await props.callbacks.edit_gamefile(async gamefile => {
					let vag = await VagAudio.from_blob(await props.path.resolve(gamefile));
					vag.data = buffer.getChannelData(0);
					vag.sample_rate = buffer.sampleRate;
					return await props.path.replace(gamefile, vag.to_blob());
				});
			}}>Import Audio</Button>
		</Box>
	)
}