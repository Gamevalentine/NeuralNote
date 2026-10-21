'use strict';
// Pinned MuScriptor GGUF v1 checkpoints from NeuralNote official ModelManifest.h.
// Checkpoints are external opt-in downloads, never embedded in the application.
const REVISION='d7045f94e8b19427f4ff9542975035e66596e51c';
const ROOT='https://huggingface.co/DamRsn/muscriptor-gguf/resolve/';
const MODELS=Object.freeze({
  small:Object.freeze({
    id:'small',label:'Small (209 MB)',filename:'muscriptor-small-f16.gguf',
    bytes:209425152,sha256:'925f55af65a20ebc4f8b45ceaf095a12b72493d436cb112623cd0041a1af23d4'
  }),
  large:Object.freeze({
    id:'large',label:'Large (2,74 GB)',filename:'muscriptor-large-f16.gguf',
    bytes:2739142176,sha256:'35a750fb1ab1e77195cdc2c0b9b4aeea2f4d59f11f729f02af9920c4854ef72e'
  }),
});
function getModel(id) {
  if(typeof id!=='string'||!Object.hasOwn(MODELS,id))throw Error('Không có checkpoint MuScriptor hợp lệ: '+String(id));
  const model=MODELS[id];
  return {...model,url:ROOT+REVISION+'/v1/'+model.filename};
}
module.exports={MODELS,getModel};
