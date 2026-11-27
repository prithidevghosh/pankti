// Live provider smoke check. Each spoken locale incurs STT, planning and TTS usage.
import assert from 'node:assert/strict';
import {interpret,readOverviewAloud,transcribe} from '../server/providers.mjs';
import {overviewAnswer} from '../server/services/overview-question.mjs';
import {voiceLanguages} from '../shared/overview-languages.mjs';

const questions={
  bn:'আজ সারাদিনে মোট কত টাকার বিক্রি হয়েছে?', en:'How much did my shop sell today?',
  gu:'આજે મારી દુકાનમાં કુલ કેટલા રૂપિયાનું વેચાણ થયું?',hi:'आज मेरी दुकान में कुल कितने रुपये की बिक्री हुई?',
  kn:'ಇಂದು ನನ್ನ ಅಂಗಡಿಯಲ್ಲಿ ಒಟ್ಟು ಎಷ್ಟು ರೂಪಾಯಿ ವ್ಯಾಪಾರ ಆಯಿತು?',ml:'ഇന്ന് എന്റെ കടയിലെ മൊത്തം വിൽപ്പന എത്ര രൂപയാണ്?',
  mr:'आज माझ्या दुकानात एकूण किती रुपयांची विक्री झाली?',od:'ଆଜି ମୋ ଦୋକାନରେ ମୋଟ କେତେ ଟଙ୍କାର ବିକ୍ରି ହୋଇଛି?',
  pa:'ਅੱਜ ਮੇਰੀ ਦੁਕਾਨ ਵਿੱਚ ਕੁੱਲ ਕਿੰਨੇ ਰੁਪਏ ਦੀ ਵਿਕਰੀ ਹੋਈ?',ta:'இன்று என் கடையில் மொத்தம் எத்தனை ரூபாய்க்கு விற்பனை நடந்தது?',
  te:'ఈ రోజు నా దుకాణంలో మొత్తం ఎన్ని రూపాయల అమ్మకాలు జరిగాయి?',
};
const day='2026-11-28';
for(const locale of Object.keys(voiceLanguages)){
  const question=questions[locale.split('-')[0]];
  const audio=Buffer.from(await readOverviewAloud(question,locale),'base64');
  const heard=await transcribe({buffer:audio,originalname:'question.wav',mimetype:'audio/wav'},[],{withLanguage:true,language:locale});
  const result=await overviewAnswer({overviewFigures:async()=>({billedSales:10500})},interpret,'qa',heard.transcript,{start:day,end:day},day,{inputHint:locale,detectedLanguage:heard.language});
  assert.equal(result.language,locale);
  assert.ok(result.facts.some(f=>f.key==='billedSales'),JSON.stringify(result));
  assert.ok((await readOverviewAloud(result.text,locale)).length>1000);
  console.log(locale,result.text);
}
