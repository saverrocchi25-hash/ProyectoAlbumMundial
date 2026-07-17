// Mock data generator for el álbum: cada selección -> 12 barajitas (1 escudo + 11 jugadores)
// Exporta: countries (array), allStickers (map id->sticker)
const COUNTRY_NAMES = [
 "Alemania","Arabia Saudita","Argelia","Argentina","Australia","Austria","Bélgica",
 "Bosnia y Herzegovina","Brasil","Cabo Verde","Canadá","Catar","Colombia","Corea del Sur",
 "Costa de Marfil","Croacia","Curazao","Ecuador","Egipto","Escocia","España","Estados Unidos",
 "Francia","Ghana","Haití","Inglaterra","Irak","Irán","Japón","Jordania","Marruecos",
 "México","Noruega","Nueva Zelanda","Países Bajos","Panamá","Paraguay","Portugal",
 "República Checa","República Democrática del Congo","Senegal","Sudáfrica","Suecia","Suiza",
 "Túnez","Turquía","Uruguay","Uzbekistán"
];

// Helper para normalizar códigos (3 letras)
function codeFromName(name){
  // tomar primeras 3 letras no acentuadas
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z]/g,'').slice(0,3);
}

function makeSticker(countryCode, index){
  // index 0 -> escudo, 1..11 -> jugadores
  if(index===0){
    return {
      id: `${countryCode}-00`,
      country: countryCode,
      type: 'escudo',
      nombre: `${countryCode} - Escudo`,
      rol: 'Escudo',
      image: 'assets/silhouette.svg'
    };
  } else {
    return {
      id: `${countryCode}-${String(index).padStart(2,'0')}`,
      country: countryCode,
      type: 'jugador',
      nombre: `Jugador ${index}`,
      rol: ['Arquero','Defensa','Centro','Delantero'][index % 4],
      image: 'assets/silhouette.svg'
    };
  }
}

export const countries = COUNTRY_NAMES.map(name=>{
  const code = codeFromName(name);
  const stickers = [];
  for(let i=0;i<12;i++) stickers.push(makeSticker(code,i));
  return {
    name, code, stickers
  };
});

// Flattened map of stickers by id
export const allStickers = {};
for(const c of countries){
  for(const s of c.stickers){
    allStickers[s.id]=s;
  }
}