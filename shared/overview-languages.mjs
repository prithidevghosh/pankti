// Saaras REST language codes. Bulbul can speak the first eleven.
export const voiceLanguages = {
  'bn-IN':'বাংলা','en-IN':'English','gu-IN':'ગુજરાતી','hi-IN':'हिन्दी','kn-IN':'ಕನ್ನಡ',
  'ml-IN':'മലയാളം','mr-IN':'मराठी','od-IN':'ଓଡ଼ିଆ','pa-IN':'ਪੰਜਾਬੀ','ta-IN':'தமிழ்','te-IN':'తెలుగు',
};
export const inputLanguages = {...voiceLanguages,
  'as-IN':'অসমীয়া','brx-IN':'बड़ो','doi-IN':'डोगरी','ks-IN':'کٲشُر','kok-IN':'कोंकणी',
  'mai-IN':'मैथिली','mni-IN':'ꯃꯤꯇꯩꯂꯣꯟ','ne-IN':'नेपाली','sa-IN':'संस्कृतम्','sat-IN':'ᱥᱟᱱᱛᱟᱲᱤ','sd-IN':'سنڌي','ur-IN':'اردو',
};
export function locale(code) {
  const base=code?.split('-')[0]?.toLowerCase();
  const canonical=(base==='or'?'od':base)+'-IN';
  return Object.hasOwn(inputLanguages,canonical)?canonical:undefined;
}
