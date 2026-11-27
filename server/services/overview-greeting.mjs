import {locale} from '../../shared/overview-languages.mjs';
import {scopeReply} from './overview-speech.mjs';

const greetings={
  'en-IN':'Hi, I’m Pankti. I’m here to help with your shop. What would you like to check?',
  'hi-IN':'नमस्ते, मैं पंक्ति हूँ। दुकान के हिसाब में आपकी मदद कर सकती हूँ। बताइए, क्या देखना चाहेंगे?',
  'bn-IN':'নমস্কার, আমি পংক্তি। আপনার দোকানের হিসাব দেখতে সাহায্য করতে পারি। কী জানতে চান?',
  'ta-IN':'வணக்கம், நான் பங்க்தி. உங்கள் கடைக் கணக்கைப் பார்க்க உதவுகிறேன். என்ன தெரிந்துகொள்ள விரும்புகிறீர்கள்?',
  'te-IN':'నమస్కారం, నేను పంక్తిని. మీ దుకాణం లెక్కలు చూడటంలో సహాయం చేస్తాను. ఏమి తెలుసుకోవాలి?',
  'gu-IN':'નમસ્તે, હું પંક્તિ છું. તમારી દુકાનનો હિસાબ જોવામાં મદદ કરી શકું છું. શું જાણવું છે?',
  'kn-IN':'ನಮಸ್ಕಾರ, ನಾನು ಪಂಕ್ತಿ. ನಿಮ್ಮ ಅಂಗಡಿಯ ಲೆಕ್ಕ ನೋಡಲು ಸಹಾಯ ಮಾಡುತ್ತೇನೆ. ಏನು ತಿಳಿಯಬೇಕು?',
  'ml-IN':'നമസ്കാരം, ഞാൻ പങ്ക്തി. കടയിലെ കണക്കുകൾ നോക്കാൻ സഹായിക്കാം. എന്താണ് അറിയേണ്ടത്?',
  'mr-IN':'नमस्कार, मी पंक्ती. दुकानाचा हिशोब पाहायला मदत करू शकते. काय पाहायचं आहे?',
  'pa-IN':'ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ, ਮੈਂ ਪੰਕਤੀ ਹਾਂ। ਦੁਕਾਨ ਦਾ ਹਿਸਾਬ ਦੇਖਣ ਵਿੱਚ ਮਦਦ ਕਰ ਸਕਦੀ ਹਾਂ। ਕੀ ਜਾਣਨਾ ਚਾਹੋਗੇ?',
  'od-IN':'ନମସ୍କାର, ମୁଁ ପଙ୍କ୍ତି। ଆପଣଙ୍କ ଦୋକାନର ହିସାବ ଦେଖିବାରେ ସାହାଯ୍ୟ କରିପାରିବି। କଣ ଜାଣିବାକୁ ଚାହାନ୍ତି?',
};
export function greetingFor(readAloud){
  const cache=new Map();
  return async preferred=>{
    const language=locale(preferred)||'en-IN';
    const text=greetings[language] || scopeReply(language,'identity');
    if(!greetings[language]) return {language,text};
    if(!cache.has(language)) cache.set(language,readAloud(text,language).catch(e=>{cache.delete(language);throw e;}));
    return {language,text,audio:await cache.get(language)};
  };
}
