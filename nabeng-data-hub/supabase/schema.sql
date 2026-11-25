-- Nabeng Data Hub orders table. Run this in Supabase SQL Editor.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_ref text unique not null,
  bundle_id integer not null,
  network text not null,
  network_code text not null,
  size text not null,
  label text not null,
  amount numeric(10,2) not null,
  recipient text not null,
  email text,
  paystack_reference text unique,
  datarjust_order_id text,
  datarjust_reference text,
  status text not null default 'pending_payment',
  -- pending_payment | payment_init_failed | paid | processing | delivered | delivery_failed
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_order_ref_idx on public.orders(order_ref);
create index if not exists orders_paystack_reference_idx on public.orders(paystack_reference);
create index if not exists orders_recipient_idx on public.orders(recipient);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_created_at_idx on public.orders(created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at before update on public.orders
for each row execute function public.set_updated_at();

alter table public.orders enable row level security;
-- Service-role keys bypass RLS. Do not create a permissive policy for anon/authenticated users.
drop policy if exists "Service role full access" on public.orders;

-- Atomic delivery claim: only one webhook/verify request can move a paid order to processing.
create or replace function public.claim_order_delivery(p_order_ref text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare claimed_count integer;
begin
  update public.orders
     set status = 'processing', failure_reason = null
   where order_ref = p_order_ref
     and status in ('paid', 'delivery_failed');
  get diagnostics claimed_count = row_count;
  return claimed_count = 1;
end;
$$;
revoke all on function public.claim_order_delivery(text) from public, anon, authenticated;
grant execute on function public.claim_order_delivery(text) to service_role;
