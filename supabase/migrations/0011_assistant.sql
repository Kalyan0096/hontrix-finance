-- Milestone 10: AI business assistant. The model never writes SQL: it can only call these fixed, read-only functions.
-- All are SECURITY INVOKER, so row-level security limits them to what the signed-in person may already see.
-- Every result carries the date it applies to and a plain-language "method", so any figure can be traced.

create function ai_check_range(p_from date, p_to date) returns void language plpgsql immutable as $$
begin
  if p_from is null or p_to is null or p_from > p_to then raise exception 'invalid date range: from must not be after to'; end if;
  if p_to - p_from > 1100 then raise exception 'date range too long (maximum 3 years)'; end if;
end $$;

create function ai_business_summary(p_from date, p_to date) returns jsonb language plpgsql stable security invoker set search_path = public as $$
begin
  perform ai_check_range(p_from, p_to);
  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'loans_given', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(principal_amount), 0)) from loans where source = 'new' and disbursement_date between p_from and p_to),
    'collections', (select jsonb_build_object('net', coalesce(sum(amount), 0), 'receipts', count(*) filter (where kind = 'receipt'), 'reversals', count(*) filter (where kind = 'reversal')) from payments where payment_date between p_from and p_to),
    'position_today', (select jsonb_build_object(
        'customers', (select count(*) from customers), 'active_loans', count(*),
        'principal_outstanding', coalesce(sum(principal_outstanding), 0), 'interest_outstanding', coalesce(sum(interest_outstanding), 0), 'fees_outstanding', coalesce(sum(fees_outstanding), 0),
        'total_receivable', coalesce(sum(total_receivable), 0), 'overdue_amount', coalesce(sum(overdue_amount), 0),
        'overdue_loans', count(*) filter (where overdue_amount > 0), 'overdue_installments', coalesce(sum(overdue_installments), 0))
      from v_loan_outstanding where status in ('active', 'overdue')),
    'as_of', today_ist(),
    'method', jsonb_build_array(
      'loans_given: loans created in the app with a disbursement date inside the period; balances imported from Excel are not counted as money given',
      'collections: payments received minus reversals, by payment date, inside the period',
      'position_today: live position on the as_of date for active loans. Overdue = instalments due before today and not fully paid. Interest outstanding = scheduled interest on unpaid instalments.'));
end $$;

create function ai_compare_periods(p_from_a date, p_to_a date, p_from_b date, p_to_b date) returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare a jsonb; b jsonb;
begin
  a := ai_business_summary(p_from_a, p_to_a); b := ai_business_summary(p_from_b, p_to_b);
  return jsonb_build_object(
    'period_a', jsonb_build_object('period', a->'period', 'loans_given', a->'loans_given', 'collections', a->'collections'),
    'period_b', jsonb_build_object('period', b->'period', 'loans_given', b->'loans_given', 'collections', b->'collections'),
    'a_minus_b', jsonb_build_object(
      'loans_given_count', (a#>>'{loans_given,count}')::numeric - (b#>>'{loans_given,count}')::numeric,
      'loans_given_amount', (a#>>'{loans_given,amount}')::numeric - (b#>>'{loans_given,amount}')::numeric,
      'collections_net', (a#>>'{collections,net}')::numeric - (b#>>'{collections,net}')::numeric),
    'as_of', today_ist(),
    'method', jsonb_build_array('each period is calculated exactly as in business_summary; a_minus_b = period_a minus period_b (positive means period_a is higher)'));
end $$;

create function ai_collections(p_from date, p_to date, p_group text default 'none') returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare rows_json jsonb; total jsonb;
begin
  perform ai_check_range(p_from, p_to);
  if p_group not in ('none', 'day', 'month') then raise exception 'group must be none, day or month'; end if;
  select jsonb_build_object('net', coalesce(sum(amount), 0), 'receipts', count(*) filter (where kind = 'receipt'), 'reversals', count(*) filter (where kind = 'reversal'))
    into total from payments where payment_date between p_from and p_to;
  if p_group = 'day' then
    select coalesce(jsonb_agg(jsonb_build_object('period', d, 'net', net, 'receipts', rc) order by d), '[]') into rows_json
    from (select payment_date::text d, sum(amount) net, count(*) filter (where kind = 'receipt') rc from payments where payment_date between p_from and p_to group by payment_date order by payment_date limit 400) x;
  elsif p_group = 'month' then
    select coalesce(jsonb_agg(jsonb_build_object('period', d, 'net', net, 'receipts', rc) order by d), '[]') into rows_json
    from (select to_char(date_trunc('month', payment_date), 'YYYY-MM') d, sum(amount) net, count(*) filter (where kind = 'receipt') rc from payments where payment_date between p_from and p_to group by 1 order by 1 limit 40) x;
  else rows_json := '[]'; end if;
  return jsonb_build_object('period', jsonb_build_object('from', p_from, 'to', p_to), 'total', total, 'group', p_group, 'rows', rows_json, 'as_of', today_ist(),
    'method', jsonb_build_array('collections = payments received minus reversals, by payment date. Days or months with no payments are not listed.'));
end $$;

create function ai_loans_given(p_from date, p_to date, p_group text default 'none', p_min_amount numeric default null) returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare total jsonb; rows_json jsonb;
begin
  perform ai_check_range(p_from, p_to);
  if p_group not in ('none', 'month', 'vehicle_category') then raise exception 'group must be none, month or vehicle_category'; end if;
  select jsonb_build_object('count', count(*), 'amount', coalesce(sum(principal_amount), 0)) into total
    from loans where source = 'new' and disbursement_date between p_from and p_to and principal_amount >= coalesce(p_min_amount, 0);
  if p_group = 'month' then
    select coalesce(jsonb_agg(jsonb_build_object('period', m, 'count', c, 'amount', a) order by m), '[]') into rows_json
    from (select to_char(date_trunc('month', disbursement_date), 'YYYY-MM') m, count(*) c, sum(principal_amount) a from loans
          where source = 'new' and disbursement_date between p_from and p_to and principal_amount >= coalesce(p_min_amount, 0) group by 1 limit 40) x;
  elsif p_group = 'vehicle_category' then
    select coalesce(jsonb_agg(jsonb_build_object('vehicle_category', k, 'count', c, 'amount', a) order by a desc), '[]') into rows_json
    from (select v.category::text k, count(*) c, sum(l.principal_amount) a from loans l join vehicles v on v.id = l.vehicle_id
          where l.source = 'new' and l.disbursement_date between p_from and p_to and l.principal_amount >= coalesce(p_min_amount, 0) group by 1) x;
  else
    select coalesce(jsonb_agg(jsonb_build_object('loan_id', id, 'loan_no', loan_no, 'customer', cn, 'amount', pa, 'given_on', dd) order by pa desc), '[]') into rows_json
    from (select l.id, l.loan_no, left(c.full_name, 80) cn, l.principal_amount pa, l.disbursement_date dd from loans l join customers c on c.id = l.customer_id
          where l.source = 'new' and l.disbursement_date between p_from and p_to and l.principal_amount >= coalesce(p_min_amount, 0) order by l.principal_amount desc limit 25) x;
  end if;
  return jsonb_build_object('period', jsonb_build_object('from', p_from, 'to', p_to), 'min_amount', p_min_amount, 'total', total, 'group', p_group, 'rows', rows_json, 'as_of', today_ist(),
    'method', jsonb_build_array('loans created in the app whose disbursement date is inside the period; balances imported from Excel are excluded. With group none, at most the 25 largest loans are listed (total covers all).'));
end $$;

create function ai_overdue_loans(p_min_installments int default 1, p_min_amount numeric default 0, p_limit int default 20) returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare lim int := greatest(1, least(coalesce(p_limit, 20), 50)); total jsonb; rows_json jsonb;
begin
  select jsonb_build_object('loans', count(*), 'overdue_amount', coalesce(sum(o.overdue_amount), 0)) into total
    from v_loan_outstanding o where o.overdue_amount > 0 and o.status in ('active', 'overdue') and o.overdue_installments >= coalesce(p_min_installments, 1) and o.overdue_amount >= coalesce(p_min_amount, 0);
  select coalesce(jsonb_agg(jsonb_build_object('loan_id', loan_id, 'loan_no', loan_no, 'register_no', ext, 'customer_id', customer_id, 'customer', cn, 'vehicle', reg, 'overdue_amount', oa,
           'overdue_installments', oi, 'oldest_unpaid_due_date', nd, 'total_receivable', tr) order by oa desc), '[]') into rows_json
  from (select o.loan_id, o.loan_no, l.external_ref ext, o.customer_id, left(c.full_name, 80) cn, v.registration_number reg, o.overdue_amount oa, o.overdue_installments oi, o.next_due_date nd, o.total_receivable tr
        from v_loan_outstanding o join loans l on l.id = o.loan_id join customers c on c.id = o.customer_id join vehicles v on v.id = o.vehicle_id
        where o.overdue_amount > 0 and o.status in ('active', 'overdue') and o.overdue_installments >= coalesce(p_min_installments, 1) and o.overdue_amount >= coalesce(p_min_amount, 0)
        order by o.overdue_amount desc limit lim) x;
  return jsonb_build_object('filters', jsonb_build_object('min_installments', coalesce(p_min_installments, 1), 'min_amount', coalesce(p_min_amount, 0)), 'total', total, 'rows', rows_json, 'rows_limit', lim, 'as_of', today_ist(),
    'method', jsonb_build_array('overdue = instalments due before today that are not fully paid, summed per loan; total covers all matching loans, rows lists the largest up to rows_limit'));
end $$;

create function ai_outstanding(p_group text default 'none') returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare rows_json jsonb;
begin
  if p_group not in ('none', 'vehicle_category', 'loan_status') then raise exception 'group must be none, vehicle_category or loan_status'; end if;
  if p_group = 'vehicle_category' then
    select coalesce(jsonb_agg(jsonb_build_object('vehicle_category', k, 'loans', n, 'principal_outstanding', p, 'interest_outstanding', i, 'total_receivable', t, 'overdue_amount', od) order by t desc), '[]') into rows_json
    from (select v.category::text k, count(*) n, sum(o.principal_outstanding) p, sum(o.interest_outstanding) i, sum(o.total_receivable) t, sum(o.overdue_amount) od
          from v_loan_outstanding o join vehicles v on v.id = o.vehicle_id where o.status in ('active', 'overdue') group by 1) x;
  elsif p_group = 'loan_status' then
    select coalesce(jsonb_agg(jsonb_build_object('status', k, 'loans', n, 'principal_outstanding', p, 'interest_outstanding', i, 'total_receivable', t, 'overdue_amount', od) order by t desc), '[]') into rows_json
    from (select (case when o.status = 'active' and o.overdue_amount > 0 then 'overdue' else o.status::text end) k, count(*) n, sum(o.principal_outstanding) p, sum(o.interest_outstanding) i, sum(o.total_receivable) t, sum(o.overdue_amount) od
          from v_loan_outstanding o group by 1) x;
  else rows_json := '[]'; end if;
  return jsonb_build_object('group', p_group,
    'total', (select jsonb_build_object('loans', count(*), 'principal_outstanding', coalesce(sum(principal_outstanding), 0), 'interest_outstanding', coalesce(sum(interest_outstanding), 0),
              'fees_outstanding', coalesce(sum(fees_outstanding), 0), 'total_receivable', coalesce(sum(total_receivable), 0), 'overdue_amount', coalesce(sum(overdue_amount), 0)) from v_loan_outstanding where status in ('active', 'overdue')),
    'rows', rows_json, 'as_of', today_ist(),
    'method', jsonb_build_array('active loans only. principal_outstanding = principal of unpaid instalments; interest_outstanding = scheduled interest on unpaid instalments (not interest accrued to today); total_receivable = principal + interest + fees still to be paid'));
end $$;

create function ai_find_customers(p_query text, p_limit int default 10) returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare q text := trim(coalesce(p_query, '')); esc text; regq text; lim int := greatest(1, least(coalesce(p_limit, 10), 20)); rows_json jsonb;
begin
  if length(q) < 2 or length(q) > 60 then raise exception 'query must be 2 to 60 characters'; end if;
  esc := regexp_replace(q, '([%_\\])', '\\\1', 'g');
  regq := regexp_replace(upper(q), '[\s-]', '', 'g');
  select coalesce(jsonb_agg(jsonb_build_object('customer_id', id, 'customer_no', customer_no, 'name', nm, 'mobile', mobile, 'status', status, 'vehicles', vehicles, 'loans', loans_n) order by nm), '[]') into rows_json
  from (select c.id, c.customer_no, left(c.full_name, 80) nm, c.mobile, c.status::text status,
               coalesce((select jsonb_agg(v.registration_number order by v.registration_number) from vehicles v where v.customer_id = c.id), '[]') vehicles,
               (select count(*) from loans l where l.customer_id = c.id) loans_n
        from customers c
        where c.full_name ilike '%' || esc || '%' or c.customer_no ilike '%' || esc || '%' or c.mobile like '%' || esc || '%'
           or exists (select 1 from vehicles v where v.customer_id = c.id and v.registration_number ilike '%' || regexp_replace(regq, '([%_\\])', '\\\1', 'g') || '%')
           or exists (select 1 from loans l where l.customer_id = c.id and (l.loan_no ilike '%' || esc || '%' or l.external_ref ilike '%' || esc || '%'))
        order by c.full_name limit lim) x;
  return jsonb_build_object('query', q, 'rows', rows_json, 'rows_limit', lim, 'as_of', today_ist(), 'method', jsonb_build_array('matches name, customer number, mobile, vehicle registration, loan number or register number'));
end $$;

create function ai_customer_detail(p_customer_id uuid) returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare c customers%rowtype;
begin
  select * into c from customers where id = p_customer_id;
  if not found then raise exception 'customer not found'; end if;
  return jsonb_build_object(
    'customer', jsonb_build_object('customer_id', c.id, 'customer_no', c.customer_no, 'name', left(c.full_name, 80), 'mobile', c.mobile, 'district', c.district, 'state', c.state, 'status', c.status),
    'vehicles', coalesce((select jsonb_agg(jsonb_build_object('registration', v.registration_number, 'make', v.make, 'model', v.model, 'year', v.manufacture_year, 'category', v.category, 'insurance_expiry', v.insurance_expiry) order by v.registration_number)
                          from vehicles v where v.customer_id = c.id), '[]'),
    'loans', coalesce((select jsonb_agg(jsonb_build_object('loan_id', o.loan_id, 'loan_no', o.loan_no, 'register_no', l.external_ref, 'status', o.status, 'principal', o.principal_amount, 'principal_outstanding', o.principal_outstanding,
                       'interest_outstanding', o.interest_outstanding, 'overdue_amount', o.overdue_amount, 'next_due_date', o.next_due_date) order by o.loan_no)
                       from v_loan_outstanding o join loans l on l.id = o.loan_id where o.customer_id = c.id), '[]'),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('document_id', d.id, 'category', d.category, 'title', left(d.title, 80), 'status', d.effective_status, 'expiry_date', d.expiry_date) order by d.category)
                           from v_documents d where d.customer_id = c.id), '[]'),
    'open_follow_ups', (select count(*) from follow_up_tasks t where t.customer_id = c.id and t.status = 'open'),
    'as_of', today_ist(), 'method', jsonb_build_array('loan figures are live; see loan_detail for instalment-level information'));
end $$;

create function ai_loan_detail(p_loan text) returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare ref text := trim(coalesce(p_loan, '')); l loans%rowtype;
begin
  if length(ref) < 1 or length(ref) > 60 then raise exception 'loan reference must be 1 to 60 characters'; end if;
  if ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then select * into l from loans where id = ref::uuid;
  else select * into l from loans where lower(loan_no) = lower(ref) or lower(external_ref) = lower(ref) order by loan_no limit 1; end if;
  if not found then raise exception 'loan not found'; end if;
  return jsonb_build_object(
    'loan', (select jsonb_build_object('loan_id', l.id, 'loan_no', l.loan_no, 'register_no', l.external_ref, 'source', l.source, 'status', o.status, 'customer_id', c.id, 'customer', left(c.full_name, 80),
              'vehicle', v.registration_number, 'given_on', l.disbursement_date, 'principal', l.principal_amount)
             from v_loan_outstanding o join customers c on c.id = l.customer_id join vehicles v on v.id = l.vehicle_id where o.loan_id = l.id),
    'terms', (select jsonb_build_object('interest_method', t.interest_method, 'rate_per_year_percent', t.interest_rate_pa, 'frequency', t.frequency, 'instalments', t.tenure_installments, 'instalment_amount', t.installment_amount,
              'first_due', t.first_due_date, 'final_due', t.final_due_date, 'skips_sundays', t.skip_sundays) from loan_terms t where t.loan_id = l.id and t.is_current),
    'outstanding', (select jsonb_build_object('principal', principal_outstanding, 'interest', interest_outstanding, 'fees', fees_outstanding, 'total_receivable', total_receivable, 'overdue_amount', overdue_amount,
              'overdue_installments', overdue_installments, 'next_due_date', next_due_date) from v_loan_outstanding where loan_id = l.id),
    'schedule', (select jsonb_build_object('instalments', count(*), 'paid', count(*) filter (where status = 'paid'), 'partially_paid', count(*) filter (where status = 'partially_paid'),
              'overdue', count(*) filter (where status = 'overdue'), 'due_today', count(*) filter (where status = 'due'), 'upcoming', count(*) filter (where status = 'upcoming')) from v_schedule_status where loan_id = l.id),
    'recent_payments', coalesce((select jsonb_agg(jsonb_build_object('date', payment_date, 'type', kind, 'amount', amount, 'method', method, 'reference', left(transaction_ref, 40)) order by payment_date desc, created_at desc)
                                 from (select * from payments where loan_id = l.id order by payment_date desc, created_at desc limit 10) p), '[]'),
    'missing_required_documents', coalesce((select jsonb_agg(category) from v_loan_missing_documents where loan_id = l.id), '[]'),
    'as_of', today_ist(), 'method', jsonb_build_array('live figures; payments shown are the 10 most recent entries (reversals appear as negative amounts)'));
end $$;

create function ai_find_documents(p_customer_id uuid default null, p_category text default null, p_status text default null, p_expiring_within_days int default null, p_expired boolean default false, p_limit int default 20)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare lim int := greatest(1, least(coalesce(p_limit, 20), 50)); rows_json jsonb; n bigint;
begin
  select count(*) into n from v_documents d where (p_customer_id is null or d.customer_id = p_customer_id) and (p_category is null or d.category = p_category::document_category)
    and (p_status is null or d.effective_status = p_status::document_status) and (p_expiring_within_days is null or d.days_to_expiry between 0 and p_expiring_within_days) and (not coalesce(p_expired, false) or d.effective_status = 'expired');
  select coalesce(jsonb_agg(jsonb_build_object('document_id', id, 'customer_id', customer_id, 'customer', cn, 'category', category, 'title', t, 'status', st, 'expiry_date', expiry_date, 'days_to_expiry', dte, 'latest_version', lv, 'page', '/documents/' || id) order by cn, category), '[]') into rows_json
  from (select d.id, d.customer_id, left(c.full_name, 80) cn, d.category, left(d.title, 80) t, d.effective_status st, d.expiry_date, d.days_to_expiry dte, d.latest_version_no lv
        from v_documents d join customers c on c.id = d.customer_id
        where (p_customer_id is null or d.customer_id = p_customer_id) and (p_category is null or d.category = p_category::document_category)
          and (p_status is null or d.effective_status = p_status::document_status) and (p_expiring_within_days is null or d.days_to_expiry between 0 and p_expiring_within_days) and (not coalesce(p_expired, false) or d.effective_status = 'expired')
        order by c.full_name, d.category limit lim) x;
  return jsonb_build_object('matching', n, 'rows', rows_json, 'rows_limit', lim, 'as_of', today_ist(),
    'method', jsonb_build_array('status shown is the effective status: a document past its expiry date counts as expired. page is the screen where the document can be opened (the assistant cannot open files itself).'));
end $$;

create function ai_loans_missing_documents(p_limit int default 20) returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare lim int := greatest(1, least(coalesce(p_limit, 20), 50)); rows_json jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('loan_id', loan_id, 'loan_no', loan_no, 'customer_id', customer_id, 'customer', cn, 'missing', missing) order by cn), '[]') into rows_json
  from (select f.loan_id, f.loan_no, f.customer_id, left(c.full_name, 80) cn, (select jsonb_agg(m.category order by m.category) from v_loan_missing_documents m where m.loan_id = f.loan_id) missing
        from v_loan_file_status f join customers c on c.id = f.customer_id where f.missing_count > 0 order by c.full_name limit lim) x;
  return jsonb_build_object('loans_with_missing_documents', (select count(*) from v_loan_file_status where missing_count > 0), 'rows', rows_json, 'rows_limit', lim, 'as_of', today_ist(),
    'method', jsonb_build_array('active loans where a document type required by the business settings has no non-rejected document on file'));
end $$;

create function ai_insurance_expiry(p_within_days int default 30, p_include_expired boolean default true, p_limit int default 30) returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare lim int := greatest(1, least(coalesce(p_limit, 30), 50)); within int := greatest(0, least(coalesce(p_within_days, 30), 365)); rows_json jsonb; n bigint;
begin
  select count(*) into n from vehicles v where v.insurance_expiry <= today_ist() + within and (coalesce(p_include_expired, true) or v.insurance_expiry >= today_ist());
  select coalesce(jsonb_agg(jsonb_build_object('customer_id', customer_id, 'customer', cn, 'vehicle', reg, 'insurance_expiry', ex, 'days_left', dl, 'has_open_loan', open_loan, 'loan_id', loan_id, 'loan_no', loan_no) order by ex), '[]') into rows_json
  from (select v.customer_id, left(c.full_name, 80) cn, v.registration_number reg, v.insurance_expiry ex, v.insurance_expiry - today_ist() dl, (ln.id is not null) open_loan, ln.id loan_id, ln.loan_no
        from vehicles v join customers c on c.id = v.customer_id
        left join lateral (select l.id, l.loan_no from loans l where l.vehicle_id = v.id and l.status in ('active', 'overdue') order by l.loan_no limit 1) ln on true
        where v.insurance_expiry <= today_ist() + within and (coalesce(p_include_expired, true) or v.insurance_expiry >= today_ist()) order by v.insurance_expiry limit lim) x;
  return jsonb_build_object('within_days', within, 'matching', n, 'rows', rows_json, 'rows_limit', lim, 'as_of', today_ist(),
    'method', jsonb_build_array('vehicles whose recorded insurance expiry date is on or before today + within_days (negative days_left = already expired). Vehicles with no insurance date recorded are not included.'));
end $$;

-- ───────────── chat history (append-only) ─────────────
create table chat_conversations (
  id uuid primary key default gen_random_uuid(),
  financier_id uuid not null default auth_financier_id() references financiers(id),
  user_id uuid not null default auth.uid() references profiles(id),
  title text not null default '' check (length(title) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, financier_id)
);
create index chat_conversations_user_idx on chat_conversations (user_id, updated_at desc);
create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  financier_id uuid not null default auth_financier_id() references financiers(id),
  user_id uuid not null default auth.uid() references profiles(id),
  conversation_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(content) between 1 and 20000),
  tool_trace jsonb,
  model text,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, financier_id) references chat_conversations (id, financier_id)
);
create index chat_messages_conv_idx on chat_messages (conversation_id, created_at);
create index chat_messages_user_day_idx on chat_messages (user_id, created_at);
create trigger trg_append_only before update or delete on chat_messages for each row execute function forbid_mutation();

create function ai_questions_today() returns int language sql stable security invoker set search_path = public as
$$ select count(*)::int from chat_messages where user_id = auth.uid() and role = 'user' and (created_at at time zone 'Asia/Kolkata')::date = today_ist() $$;

alter table chat_conversations enable row level security;
alter table chat_messages enable row level security;
-- Everyone sees their own conversations; the owner can read all of the business's (for oversight). Using the assistant needs the assistant.use permission (owners always have it).
create policy chatc_select on chat_conversations for select to authenticated using (financier_id = auth_financier_id() and (user_id = auth.uid() or auth_role() = 'owner'));
create policy chatc_insert on chat_conversations for insert to authenticated with check (financier_id = auth_financier_id() and user_id = auth.uid() and has_permission('assistant.use'));
create policy chatc_update on chat_conversations for update to authenticated using (user_id = auth.uid()) with check (financier_id = auth_financier_id() and user_id = auth.uid());
create policy chatm_select on chat_messages for select to authenticated using (financier_id = auth_financier_id() and (user_id = auth.uid() or auth_role() = 'owner'));
create policy chatm_insert on chat_messages for insert to authenticated with check (financier_id = auth_financier_id() and user_id = auth.uid() and has_permission('assistant.use')
  and exists (select 1 from chat_conversations c where c.id = conversation_id and c.user_id = auth.uid()));

revoke all on chat_conversations, chat_messages from anon, authenticated;
grant select, insert on chat_messages to authenticated;
grant select, insert on chat_conversations to authenticated;
grant update (title, updated_at) on chat_conversations to authenticated;
grant all on chat_conversations, chat_messages to service_role;

revoke execute on function ai_check_range(date, date), ai_business_summary(date, date), ai_compare_periods(date, date, date, date), ai_collections(date, date, text), ai_loans_given(date, date, text, numeric),
  ai_overdue_loans(int, numeric, int), ai_outstanding(text), ai_find_customers(text, int), ai_customer_detail(uuid), ai_loan_detail(text),
  ai_find_documents(uuid, text, text, int, boolean, int), ai_loans_missing_documents(int), ai_insurance_expiry(int, boolean, int), ai_questions_today() from public, anon;
grant execute on function ai_check_range(date, date), ai_business_summary(date, date), ai_compare_periods(date, date, date, date), ai_collections(date, date, text), ai_loans_given(date, date, text, numeric),
  ai_overdue_loans(int, numeric, int), ai_outstanding(text), ai_find_customers(text, int), ai_customer_detail(uuid), ai_loan_detail(text),
  ai_find_documents(uuid, text, text, int, boolean, int), ai_loans_missing_documents(int), ai_insurance_expiry(int, boolean, int), ai_questions_today() to authenticated;
