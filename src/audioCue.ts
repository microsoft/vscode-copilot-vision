/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

function playAudio(url: string): Promise<HTMLAudioElement> {
	return new Promise((resolve, reject) => {
		const audio = new Audio(url);
		// TODO: use the settings to determine the volume
		audio.volume = 1.0;
		audio.addEventListener('ended', () => {
			resolve(audio);
		});
		audio.addEventListener('error', (e) => {
			// When the error event fires, ended might not be called
			reject(e.error);
		});
		audio.play().catch(e => {
			// When play fails, the error event is not fired.
			reject(e);
		});
	});
}
  
// Sound file: Message Sent.wav by Froey_
// Source: https://freesound.org/people/Froey_/sounds/760370/
// License: Creative Commons 0 (CC0)
export async function playSentSound(enabled: boolean): Promise<HTMLAudioElement | undefined> {
	if (!enabled) {
		return;
	}
	console.log('playing sent');
	playAudio('assets/sounds/sent.wav');
}

// Sound file: Gravel Drop Single.wav by dichardson
// Source: https://freesound.org/s/570967/
// License: Creative Commons 0 (CC0)
export async function playReceivedSound(enabled: boolean): Promise<HTMLAudioElement | undefined> {
	if (!enabled) {
		return;
	}
	console.log('playing received');
	return playAudio('assets/sounds/received.wav');
}

