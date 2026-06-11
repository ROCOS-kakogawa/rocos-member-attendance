create policy "rocos member attendance read"
on public.register_state
for select
to anon, authenticated
using (id = 'rocos-works-member-attendance');

create policy "rocos member attendance insert"
on public.register_state
for insert
to anon, authenticated
with check (id = 'rocos-works-member-attendance');

create policy "rocos member attendance update"
on public.register_state
for update
to anon, authenticated
using (id = 'rocos-works-member-attendance')
with check (id = 'rocos-works-member-attendance');
