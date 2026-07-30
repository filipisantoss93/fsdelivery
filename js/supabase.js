const SUPABASE_URL='https://kvjvhoziqcevkzyszdke.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_NgOVxQYh3jxQ7Go7y2HTLg_rVJuQ3mc';

// Evita travamentos do LockManager observados no Safari/iOS durante a
// persistência da sessão. O Supabase continua armazenando e renovando a sessão
// normalmente, sem deixar signInWithPassword preso após autenticar.
const authLock=async(_name,_acquireTimeout,fn)=>await fn();

window.supabaseClient=window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth:{
      persistSession:true,
      autoRefreshToken:true,
      detectSessionInUrl:true,
      lock:authLock
    }
  }
);

// Recursos globais compartilhados pelas páginas da plataforma.
const loadGlobalScript=(src,datasetKey)=>{
  if(document.querySelector(`script[data-${datasetKey}]`))return;
  const script=document.createElement('script');
  script.src=src;
  script.defer=true;
  script.dataset[datasetKey.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]='true';
  document.head.appendChild(script);
};

loadGlobalScript('js/pull-to-refresh.js','fs-pull-refresh');
loadGlobalScript('js/navigation.js','fs-navigation');
