-- Fixed path for the pure stroke-allocation helper, identified by live advisors.
ALTER FUNCTION public.personal_strokes(int,int,int) SET search_path=public;
