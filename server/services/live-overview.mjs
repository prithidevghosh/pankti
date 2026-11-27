import { indiaDay } from '../../shared/menu-availability.mjs';
import { httpError } from '../errors.mjs';

const systemPrompt = `You are Pankti, talking live with a restaurant owner. Listen to the audio directly. Follow the owner's language; use natural conversational Hindi for Hindi and Hinglish, and adapt when they switch. Keep the thread across turns. "And yesterday?", "और unpaid?", "what about last week?" refer to the preceding topic. Do not read column headings, dates mechanically, markdown, currency symbols or multiplication signs. Speak a short, useful sentence. Say amounts and quantities as spoken words, e.g. "आज बटर रोटी सबसे ज़्यादा बिकी, कुल आठ।" Never invent business data. For any question about the shop use lookup_ledger, expanding a follow-up into a standalone query including its time period. Use the returned figures exactly. Ask naturally when more detail is needed. For every audible reply call say_to_owner with the natural response: this is the only voice output. After saying it, wait for the owner. No automatic farewell or call termination.`;
const tools = [
  { type:'function', name:'lookup_ledger', description:'Read the signed-in shop’s figures. Only use this for business questions.',
    parameters:{type:'object',properties:{question:{type:'string',description:'Standalone resolved question in the owner’s language, including timeframe and metric.'}},required:['question']} },
  { type:'function', name:'say_to_owner', description:'Say one short conversational reply in the user’s language, then listen.',
    parameters:{type:'object',properties:{text:{type:'string'},language:{type:'string',description:'BCP-47 locale, e.g. hi-IN for Hinglish or Hindi.'}},required:['text','language']} },
];
export async function openLiveOverview(sdp) {
  if(!process.env.OPENAI_API_KEY || !process.env.SARVAM_API_KEY) throw httpError(503,'Configure the realtime and Sarvam keys to start a conversation.');
  const body=new FormData();
  body.set('sdp',sdp);
  body.set('session',JSON.stringify({
    type:'realtime', model:'gpt-realtime', output_modalities:['text'],
    instructions:systemPrompt+' The current India business date is '+indiaDay()+'.',
    audio:{input:{noise_reduction:{type:'near_field'},turn_detection:{
      type:'server_vad',threshold:0.5,prefix_padding_ms:300,silence_duration_ms:650,create_response:true,interrupt_response:true,
    }}},tools,tool_choice:'required',
  }));
  const response=await fetch('https://api.openai.com/v1/realtime/calls',{
    method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY},body,signal:AbortSignal.timeout(20000),
  });
  if(!response.ok) throw httpError(502,'The realtime voice service could not open the call. Try connecting again.');
  return response.text();
}
