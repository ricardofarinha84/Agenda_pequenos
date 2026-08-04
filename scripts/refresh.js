// scripts/refresh.js
// Corre via GitHub Actions — lê fontes.json, pesquisa eventos via API da Anthropic,
// escreve eventos.json e atualiza os timestamps em fontes.json.

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TAMANHO_LOTE   = 5;
const INTERVALO_DIAS = 5;
const TIPOS_VALIDOS  = ['Literatura','Workshop/Oficina','Música','Teatro/Espetáculo',
                        'Exposição','Ar livre','Família/Diversos','Cinema','Outro'];

// ─── Utilitários de data ────────────────────────────────────────────────────

function isoLocal(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const dia = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dia}`;
}

function hojeISO(){ return isoLocal(new Date()); }

function isPassado(dataFim, dataInicio){
  const ref = dataFim || dataInicio;
  return ref && ref < hojeISO();
}

// ─── Recuperação de JSON truncado ──────────────────────────────────────────

function extrairObjetosCompletos(str){
  const objetos = [];
  let depth = 0, inicioObj = -1, dentroString = false, escape = false;
  for(let i=0; i<str.length; i++){
    const ch = str[i];
    if(dentroString){ escape = ch==='\\' && !escape; if(!escape && ch==='"') dentroString=false; continue; }
    if(ch==='"'){ dentroString=true; continue; }
    if(ch==='{'){ if(depth===0) inicioObj=i; depth++; }
    else if(ch==='}'){
      depth--;
      if(depth===0 && inicioObj!==-1){
        try{ objetos.push(JSON.parse(str.slice(inicioObj,i+1))); }catch(e){}
        inicioObj=-1;
      }
    }
  }
  return objetos;
}

// ─── Leitura dos ficheiros de entrada ──────────────────────────────────────

const fontes = JSON.parse(readFileSync('fontes.json', 'utf-8'));

const eventosExistentes = existsSync('eventos.json')
  ? (JSON.parse(readFileSync('eventos.json','utf-8')).eventos || [])
  : [];

// ─── Ordenação e filtragem das fontes a pesquisar ──────────────────────────

const fontesOrdenadas = [...fontes].sort((a,b)=>{
  if(!a.ultimaAtualizacao && !b.ultimaAtualizacao) return 0;
  if(!a.ultimaAtualizacao) return -1;
  if(!b.ultimaAtualizacao) return 1;
  return a.ultimaAtualizacao.localeCompare(b.ultimaAtualizacao);
});

const agora = Date.now();
const fontesParaPesquisar = fontesOrdenadas.filter(s=>{
  if(!s.ultimaAtualizacao) return true;
  return agora - new Date(s.ultimaAtualizacao).getTime() > INTERVALO_DIAS*86400000;
});

console.log(`\n📋 Fontes totais: ${fontes.length}`);
console.log(`🔍 A pesquisar: ${fontesParaPesquisar.length} | ⏭️  Saltadas (recentes): ${fontes.length - fontesParaPesquisar.length}`);

if(!fontesParaPesquisar.length){
  console.log('✅ Todas as fontes foram pesquisadas recentemente. Nada a fazer.');
  process.exit(0);
}

// ─── Pesquisa por lote ─────────────────────────────────────────────────────

const uid = ()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);

async function pesquisarLote(lote){
  const hoje = hojeISO();
  const sitesList = lote.map(s=>`- ${s.nome} (${s.url})${s.nota?` — nota: ${s.nota}`:''}`).join('\n');

  const prompt = `Procura eventos futuros para crianças e famílias na zona do Grande Porto, Portugal, consultando estes sites:
${sitesList}

Data de hoje: ${hoje}. Considera apenas eventos com data de início entre hoje e os próximos 60 dias. Usa a pesquisa na web para verificar a agenda de cada site e procura datas concretas.

Devolve no máximo 6 eventos (os mais relevantes/próximos), com descrições curtas (até 8 palavras). Prioriza ter o array completo e bem formado a ter muitos eventos.

A tua resposta final deve conter SOMENTE o array JSON, a começar em "[" e a terminar em "]", sem texto antes ou depois:
[{"titulo":"...","fonte":"nome exato de um dos sites listados acima","local":"nome do espaço/sala, ou vazio","tipo":"um destes: Literatura, Workshop/Oficina, Música, Teatro/Espetáculo, Exposição, Ar livre, Família/Diversos, Cinema, Outro","idadeMin":numero,"idadeMax":numero,"dataInicio":"AAAA-MM-DD","dataFim":"AAAA-MM-DD ou vazio se for um único dia","hora":"HH:MM ou vazio","gratuito":true ou false ou null,"link":"URL direto do evento, senão o URL do site","descricao":"até 8 palavras"}]

Se não encontrares eventos com data confirmada, devolve [].`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    system: 'Respondes SEMPRE apenas com um array JSON válido, sem markdown, sem blocos de código, sem texto antes ou depois do array.',
    messages: [{ role: 'user', content: prompt }],
    tools: [{ type: 'web_search_20250305', name: 'web_search' }]
  });

  const textOut = response.content
    .filter(b=>b.type==='text')
    .map(b=>b.text)
    .join('\n')
    .trim()
    .replace(/```json|```/g,'');

  const inicioArray = textOut.indexOf('[');
  if(inicioArray===-1) return [];
  const fimArray = textOut.lastIndexOf(']');
  const clean = fimArray>inicioArray ? textOut.slice(inicioArray,fimArray+1) : textOut.slice(inicioArray);

  let brutos;
  try{ brutos = JSON.parse(clean); }
  catch(e){ brutos = extrairObjetosCompletos(clean); }
  if(!Array.isArray(brutos)) return [];

  const nomesValidos = new Set(lote.map(s=>s.nome));
  const isoValido = v=>typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

  return brutos
    .filter(e=>e && e.titulo && isoValido(e.dataInicio))
    .map(e=>({
      id: uid(),
      titulo: String(e.titulo).slice(0,140),
      fonte: nomesValidos.has(e.fonte) ? e.fonte : lote[0].nome,
      local: e.local ? String(e.local).slice(0,140) : '',
      tipo: TIPOS_VALIDOS.includes(e.tipo) ? e.tipo : 'Outro',
      idadeMin: Math.max(0,Math.min(18,parseInt(e.idadeMin,10)||0)),
      idadeMax: Math.max(0,Math.min(99,parseInt(e.idadeMax,10)||99)),
      dataInicio: e.dataInicio,
      dataFim: isoValido(e.dataFim) ? e.dataFim : '',
      hora: e.hora ? String(e.hora).slice(0,20) : '',
      gratuito: e.gratuito===true ? true : (e.gratuito===false ? false : null),
      link: e.link ? String(e.link).slice(0,500) : '',
      descricao: e.descricao ? String(e.descricao).slice(0,300) : '',
      isAuto: true,
      isExample: false
    }))
    .filter(ev=>!isPassado(ev.dataFim, ev.dataInicio));
}

// ─── Loop principal ────────────────────────────────────────────────────────

let eventosNovos = [];
const chavesExistentes = new Set(eventosNovos.map(ev=>`${ev.titulo.trim().toLowerCase()}|${ev.dataInicio}`));

for(let i=0; i<fontesParaPesquisar.length; i+=TAMANHO_LOTE){
  const lote = fontesParaPesquisar.slice(i, i+TAMANHO_LOTE);
  const numeroLote = Math.floor(i/TAMANHO_LOTE)+1;
  const totalLotes = Math.ceil(fontesParaPesquisar.length/TAMANHO_LOTE);
  console.log(`\n📦 Lote ${numeroLote}/${totalLotes}: ${lote.map(s=>s.nome).join(', ')}`);

  try{
    const eventos = await pesquisarLote(lote);
    let adicionados = 0;
    for(const ev of eventos){
      const chave = `${ev.titulo.trim().toLowerCase()}|${ev.dataInicio}`;
      if(!chavesExistentes.has(chave)){
        chavesExistentes.add(chave);
        eventosNovos.push(ev);
        adicionados++;
      }
    }
    console.log(`  ✅ ${eventos.length} encontrados, ${adicionados} novos`);

    // Atualizar timestamp das fontes deste lote
    const agoraStr = new Date().toISOString();
    lote.forEach(s=>{ const f=fontes.find(x=>x.id===s.id); if(f) f.ultimaAtualizacao=agoraStr; });

    // Guardar progresso após cada lote (para não perder tudo se falhar a meio)
    writeFileSync('eventos.json', JSON.stringify({
      atualizadoEm: new Date().toISOString(),
      total: eventosNovos.length,
      eventos: eventosNovos
    }, null, 2));
    writeFileSync('fontes.json', JSON.stringify(fontes, null, 2));

  }catch(err){
    console.error(`  ❌ Lote falhou: ${err.message}`);
  }
}

console.log(`\n🎉 Concluído: ${eventosNovos.length} eventos guardados em eventos.json`);
