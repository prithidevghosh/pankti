import { httpError } from '../errors.mjs';

export async function openLiveOverview(sdp) {
  if(!process.env.OPENAI_API_KEY || !process.env.SARVAM_API_KEY) throw httpError(503,'Configure the realtime and Sarvam keys to start a conversation.');
  const body=new FormData();
  body.set('sdp',sdp);
  body.set('session',JSON.stringify({
    type:'realtime', model:'gpt-realtime', output_modalities:['text'],
    instructions:'Only transcribe input for the Pankti reporting service.',
    audio:{input:{transcription:{model:'gpt-4o-transcribe',prompt:'Transcribe in the original spoken language. Preserve Hindi and other Indian languages mixed with English shop terms such as paid bill. Do not translate.'},noise_reduction:{type:'near_field'},turn_detection:{
      type:'server_vad',threshold:0.5,prefix_padding_ms:300,silence_duration_ms:650,create_response:false,interrupt_response:false,
    }}},
  }));
  const response=await fetch('https://api.openai.com/v1/realtime/calls',{
    method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY},body,signal:AbortSignal.timeout(20000),
  });
  if(!response.ok) throw httpError(502,'The realtime voice service could not open the call. Try connecting again.');
  return response.text();
}
