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