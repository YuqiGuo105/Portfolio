// Prime playback during the user's click, before the lazy call UI loads.
export function primeVoiceAudio() {
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    const context = new Context({ sampleRate: 16000 });
    const resumed = context.resume();
    resumed.catch(() => {});
    return { context, resumed };
  } catch (error) { return { error }; }
}

export function releaseVoiceAudio(activation) {
  if (activation?.context && activation.context.state !== 'closed') activation.context.close().catch(() => {});
}
