"""Apply the reviewed role-document changes; fail rather than overwrite drift."""
from pathlib import Path
import hashlib
import re

ROOT = Path('.')
DOCS = ROOT / 'docs'
PROTECTED = {
    'docs/architecture/ROUNDHOUSE_ENTITY_MODEL.md': '5f292940382888a231a372ed0788b0e572a0410b',
    'docs/architecture/ROUNDHOUSE_ROLES_AND_PERMISSIONS.md': 'bb63b777151f26e2bab9103ceef8a3d6aea374d3',
    'docs/architecture/screens/01_ROUNDHOUSE_INTAKE_SCREENS.md': '8dcd6c7b03c006aa8bcefec7a9b669b21599b551',
}

def blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()

for name, sha in PROTECTED.items():
    if blob((ROOT / name).read_bytes()) != sha:
        raise RuntimeError('Approved source changed; reconcile before applying: ' + name)

original = {str(p): p.read_text() for p in DOCS.rglob('*.md')}
texts = dict(original)
S = 'docs/architecture/screens/'
R = '**`../ROUNDHOUSE_ROLES_AND_PERMISSIONS.md`**'

def path(name):
    return name if name.startswith('docs/') else S + name

def edit(name, old, new, count=1):
    name = path(name)
    actual = texts[name].count(old)
    if actual != count:
        raise RuntimeError(f'{name}: expected {count} matches, got {actual}: {old[:100]}')
    texts[name] = texts[name].replace(old, new)

def section(name, start, end, new):
    name = path(name)
    s = texts[name]
    if s.count(start) != 1 or (end is not None and s.count(end) != 1):
        raise RuntimeError('Section mismatch: ' + name + ' ' + start)
    a = s.index(start)
    b = s.index(end, a + len(start)) if end is not None else len(s)
    texts[name] = s[:a] + new.rstrip() + '\n\n' + s[b:]

def rule(name, text):
    name = path(name)
    s = texts[name]
    marker = '\n---\n'
    if marker in s:
        texts[name] = s.replace(marker, '\n' + text.strip() + '\n' + marker, 1)
    else:
        texts[name] = s.rstrip() + '\n\n' + text.strip() + '\n'

# Property-connected viewing and private History have different scopes.
p = '11_PEOPLE.md'
edit(p, '**Viewer** is the neutral view-only Role. Viewer only appears through a legitimate Residential Property or Commercial Facility relationship.',
     '**Home (Viewer)** identifies a limited connection to a Residential Property. Facility viewing follows the governing Property authorization. **History Viewer** accesses only the person\'s private History and does not create a shared People relationship.')
edit(p, 'Viewer is view-only and is always associated with a specific Residential Property or Commercial Facility authorization. A neutral Viewer profile by itself does not create a People relationship.',
     'Property Viewers appear through authorization to the named Residential Property or Commercial Facility. They see the shared information and may use permitted Property messaging. At least one party to that relationship must have a paid subscription.')
edit(p, '- Viewer remains view-only;\n- a neutral Viewer profile alone does not create a relationship;',
     '- Property Viewers receive only shared visibility and permitted messaging;\n- private History does not expose a shared People directory;')
edit(p, '4. Viewer is the neutral view-only Role and must be attached to a legitimate Residential Property or Commercial Facility.\n5. There is no Trade Viewer Role.',
     '4. Property Viewer relationships identify the specific Property and authorized scope.\n5. History Viewer is private to the associated person; Business roster participation uses Trade or Supplier roles.')
edit(p, '- **Viewers**', '- **Home (Viewer)**')
rule(p, 'Current titles and permissions follow ' + R + '. People rows show the exact approved sub-role title. Messaging and shared organization require the relevant permission and at least one paid party: the participant or the person who owns or controls the Property or Business.')

p = '16_PROPERTY_ENTITY_SCREEN.md'
edit(p, 'The Property Entity is the permanent digital place for one Property and also a legitimate workplace for authorized Homeowners, Home Team Members, Viewers, Trade Professionals, Trade Team Members, Commercial participants, and other explicitly authorized people.',
     'The Property Entity is the permanent digital place for one Residential or Commercial Property. People participate through their authorized Property, Trade, or Supplier relationship and the exact sub-role titles in Roles & Authority.')
section(p, '## Viewer\n', '\n---\n\n# 5.', '''## Viewer

A Property Viewer has an authorized connection to this specific Property. The Residential title is **Home (Viewer)**.

The Viewer sees the shared information, may message within the authorized Property context, and can use Share RoundHouse and search/connect/setup paths. Shared interaction requires a paid subscription on the participant or Property-controlling side.

Notes, CAPTURE, Work, appointment booking, financial actions, and participant management require an operating role authorized for that action. Starting setup of another Property or Business establishes the person's relationship in that destination; it does not expand the current Property Viewer scope.

History Viewer accesses the person's separate private History under **`../../HISTORY_ENTITY_LOGIC.md`**.''')
edit(p, '2. Viewer is the neutral view-only Role and only becomes meaningful through a specific Residential Property or Commercial Facility authorization.\n3. There is no free-floating social Property relationship and no Trade Viewer Role.',
     '2. Property Viewer access is authorized for the named Property, including only shared visibility and permitted messaging.\n3. Shared interaction requires appropriate authorization and at least one paid party.')
rule(p, 'Role titles, paid eligibility, and action scope follow ' + R + '. A subscription satisfies the paid-party requirement but grants no additional ownership or access by itself.')

p = '17_BUSINESS_ENTITY_SCREEN.md'
edit(p, 'The Business Entity is the permanent digital place for one Business and a legitimate workplace for authorized Owners, Managers, Trade Professionals, Trade Team Members, and accepted outside Trade Professionals / subcontractors.',
     'The Business Entity is the permanent digital place for one Trade or Supplier Business. Its participants use the exact approved Trade or Supplier sub-role titles and act within their authorized scope.')
section(p, 'Primary groups:\n', '\n### Business → Subcontractor Flow', '''Primary groups:

1. **Owners / Managers / Admins**
2. **Business Participants**
3. **Subcontractors / Outside Trade Professionals**

These are roster groupings. Each person displays the exact approved Trade or Supplier title. Employment and subcontracting describe the working relationship separately from that title.

### Add / Invite

An authorized Owner, Manager, or Admin uses **+ Add / Invite** to choose the intended Trade or Supplier sub-role and review the Business relationship and permission scope.

Shared organization requires at least one paid party and authorization to manage participants. A Viewer entering setup establishes an appropriate relationship in the destination Business before using its operating tools.

Pending invitations remain separate from active participants and are also visible in the Invitation Center.
''')
section(p, '## Unaffiliated Viewer — September 14, 2026 governing update', None, '''## History and Changes in Participation

Changing a Business role or ending its relationship preserves the person's contributions and original Role, authority, date, and source context.

After the first completed Property or Business connection, the person's private History remains available alongside current relationships and after the last such relationship ends. **History** is the Entity name; **History Viewer** is the role used to access it. See **`../../HISTORY_ENTITY_LOGIC.md`**.

New accounts complete their first legitimate Property or Business connection before entering the Command Center.''')
rule(p, 'Role titles and authority follow ' + R + '. Shared coordination requires both the relevant permission and at least one paid party. Business access does not by itself grant access to a client Property or another person\'s private History.')

p = '27_BUSINESS_TEAM.md'
edit(p, '**Viewer is not a Business Team category.** Viewer is the neutral view-only Role used when someone is deliberately added to a Residential Property or Commercial Facility.',
     'Business Team rows use the approved Trade or Supplier sub-role. Property viewing and the person\'s private History have their own Viewer context rather than Business roster authority.')
edit(p, '**Trade Team Members belong to the Business. Subcontractors work with the Business.**',
     '**Internal participants work within the Business. Subcontractors work with the Business.** These relationship descriptions do not replace the person\'s approved role title.')
section(p, 'Typical choices include:\n', 'The invitation appears in the global Invitation Center', '''Choose the intended sub-role from the approved Trade or Supplier catalogue and record any subcontracting relationship separately.

The invitation preserves the exact title, granted authority, and scope. A plain-language confirmation reads, for example:

**Invite Carlos Hernandez to DMT DESIGN BUILD as Trade Professional for subcontracted work?**

''')
rule(p, 'Current roles and authority follow ' + R + '. Each roster row and invitation shows the exact approved Trade or Supplier title, including parentheses and the en dash for combined positions. Adding or organizing participants requires authorized Owner, Manager, or Admin scope and at least one paid party; a free participant can join a paid Business within the scope granted.')

p = '33_INVITATIONS.md'
section(p, '# 4. Viewer\n', '# 5. Add-to-Entity Flow', '''# 4. Viewer

A Viewer invitation names the Residential Property or Commercial Facility, the information shared, and the permitted messaging scope. The Residential display title is **Home (Viewer)**.

The Viewer may be paid or unpaid. The Viewer or the person owning or controlling the Property must have a paid subscription for this shared relationship. Consent and authorization are required in addition to subscription eligibility.

**History Viewer** is the role inside the person's private History. That History is available only to its associated person after their first completed Property or Business connection. Share RoundHouse from History invites someone to the platform or a legitimate Property/Business connection, not into the sender's private History.

Both Viewer contexts provide Share RoundHouse and search/connect/setup paths. New Property or Business operations use the relationship established in that destination. Free accounts may create one Property and one Business. Ownership transfer starts when the legitimate claimant finds the record and requests transfer from its current controller.

---
''')
section(p, '### Property / Facility\n', '# 6. Business → Subcontractor', '''### Property / Facility

The invitation identifies the Property, the person's intended Property sub-role, and authorized scope. Residential choices use **Home Pro (Manager)**, **Home Pro (Teammate)**, **Home (Viewer)**, or another applicable approved Home title. An invited Trade or Supplier participant retains the appropriate Business role and receives separately authorized Property access.

### Business

The invitation uses an approved Trade or Supplier sub-role, with employment or subcontracting recorded as the working relationship. Owner, Manager, Lead, and combined positions use the exact parentheses and en dash defined in Roles & Authority.

The exact choices depend on the inviter's authority, the intended relationship, and subscription eligibility.

RoundHouse shows a plain-language confirmation before sending, for example:

**Invite Carlos Hernandez to DMT DESIGN BUILD as Trade Professional for subcontracted work?**

**Invite Maria Lopez to Spring Lake Residence as Home (Viewer)?**

---
''')
section(p, '# 18. Vocabulary\n', '## Governing Rule', '''# 18. Role Titles and Invitation Language

Role categories and sub-role titles come from **`../ROUNDHOUSE_ROLES_AND_PERMISSIONS.md`**. Invitations preserve the exact displayed title, the authority requested, and its source.

Use **Invite**, **Add / Invite**, and **Request Access** for the action. **Subcontractor** and other working descriptions accompany the role where useful. **Business-derived access** and **Independent Property access** identify permission sources.

---
''')
edit(p, 'Viewer is the neutral view-only Role and must always be attached to a legitimate Residential Property or Commercial Facility.',
     'Property Viewer invitations establish scoped access to the named Property. History stays private to its associated person. Shared interaction requires at least one paid party and appropriate authorization.')
rule(p, 'Titles and authority follow ' + R + '. Shared interaction requires at least one paid party: the participating person or the person who owns or controls the Property or Business. Subscription eligibility, participant consent, and authorization are checked separately. An invitation remains pending until the required conditions are satisfied; a new account enters the Command Center only after its first completed relationship.')

p = '32_NOTIFICATIONS.md'
section(p, '# 7. Viewer Notifications\n', '# 8. Push Notifications', '''# 7. Viewer Notifications

A Property Viewer notification names the Property and exact current role title, for example:

**Sarah Miller invited you to Spring Lake Residence as Home (Viewer).**

The invitation identifies the shared information and messaging scope. Activation follows the paid-party and authorization rules in **`33_INVITATIONS.md`**.

History Viewer receives notices relevant to the person's own account, retained history, or connection requests. A notification does not invite another person into private History or reopen a former Property or Business.

---
''')
rule(p, 'Notifications use the exact approved role title from ' + R + '. A notification reports the underlying relationship or record; it does not grant access or change historical attribution.')

# Rewards distinguish role eligibility from paid access and never gamify Viewers.
p = '04_ROUNDHOUSE_REWARD_CENTER_SCREENS.md'
edit(p, '# Screen 1 — Trade Professional Owner / Manager Reward Center', '# Screen 1 — Trade Owner and Manager Reward Center')
edit(p, 'This is the full Trade version.',
     'This version serves **Trade Pro (Owner)**, **Trade Pro (Manager)**, **Trade Pro (Owner – Lead)**, and **Trade Pro (Manager – Lead)** within their authorized reward-management scope.')
edit(p, '# Screen 2 — Homeowner Owner / Manager Reward Center', '# Screen 2 — Home Owner and Manager Reward Center')
edit(p, 'This is the full Home version and follows nearly the same layout and behavior as the Trade Owner/Manager screen.',
     'This version serves **Home Pro (Owner)** and **Home Pro (Manager)**. The standard **Homeowner** retains the eligible individual reward experience without team-organization or reward-management controls.')
edit(p, '# Screen 3 — Trade Team Member Reward Center', '# Screen 3 — Trade Participant Reward Center')
edit(p, 'This is a scaled-back individual version.',
     'This is the individual reward view for **Trade Professional** and **Trade Pro (Lead)**. Lead responsibility alone does not grant the Owner/Manager reward controls.')
edit(p, '# Screen 4 — Home Team Member Reward Center', '# Screen 4 — Home Pro (Teammate) Reward Center')
edit(p, '| Capability | Trade Owner / Manager | Homeowner Owner / Manager | Trade Team Member | Home Team Member |',
     '| Capability | Trade Owner/Manager positions | Home Pro (Owner) / Home Pro (Manager) | Trade Professional / Trade Pro (Lead) | Home Pro (Teammate) |')
rule(p, 'Role titles and access follow ' + R + '. **Home (Viewer)**, other authorized Property viewing, and **History Viewer** do not earn points, badges, or status progression. Historical achievements may remain visible in History. Pro subscription status is separate from earned reward Status. Admin reward eligibility follows the reward policy rather than being inferred from administrative control.')

# Calendar, messaging, and creation entry points enforce the approved scope.
p = '14_CALENDAR.md'
edit(p, 'For a Trade Professional Owner or Manager, Calendar shows the business schedule across the Properties they legitimately manage.',
     'For **Trade Pro (Owner)**, **Trade Pro (Manager)**, **Trade Pro (Owner – Lead)**, **Trade Pro (Manager – Lead)**, or **Trade Admin** with scheduling authority, Calendar shows the Business schedule across the Properties they legitimately manage. Authorized Property and Supplier managers use the corresponding scheduling scope.')
rule(p, 'Role titles and scheduling authority follow ' + R + '. Shared scheduling requires at least one paid party and the applicable permission. Property viewing and History Viewer provide no appointment-creation or team-scheduling authority; retained appointment records remain viewable through History.')

p = '08_ROUNDHOUSE_PROPERTIES_WORKING_FUNCTION.md'
edit(p, 'The commercial Property remains its own Property Entity with its own authority structure. If entering or acting within it requires a Commercial Management / Facility Management context, Roundhouse should make that acting-context change explicit rather than silently treating Homeowner authority as commercial management authority.',
     'A Commercial Property retains its own authorized Property relationship. Entering it makes the current Role and granted authority explicit; a Residential Property role does not automatically authorize action at a Facility.')
rule(p, 'Role titles, authorization, and creation limits follow ' + R + '. **+ Add Property** enters **`01_ROUNDHOUSE_INTAKE_SCREENS.md`** after personal Identity, retaining Back and Review/Edit behavior. A free account that has created one Property sees **Add Pro to create another Property**. Search and authorized connection remain available. A Property may be created for administration without being described as the creator\'s home.')

rule('05_COMMAND_CENTER_MESSAGES.md', 'Messaging uses an authorized Property or Business context and the paid-party rule in ' + R + '. A Property Viewer may message within the granted scope. History Viewer reviews retained messages but creates no new messages in History. Sharing RoundHouse and connection/setup use their dedicated pathways.')
rule('06_ROUNDHOUSE_DAILY_GRIND.md', 'Role-dependent actions follow ' + R + '. Shared organization requires the applicable permission and at least one paid party. History Viewer retains past records without opening an active Daily Grind or creating new work from History.')
rule('07_ROUNDHOUSE_LISTS_NOTES_REMINDERS_RECEIPTS.md', 'Current role titles and action permissions follow ' + R + '. New Notes, Tasks, Lists, and documentation retain their authorized Property or Business context. History presents retained contributions; its Viewer has no creation or editing controls. Shared organization follows the paid-party rule.')
rule('09_ROUNDHOUSE_RESOLUTION_CENTER.md', 'Role titles and action scope follow ' + R + '. Creating or responding to Resolutions requires the relevant authorized Property or Business relationship and paid-party eligibility. A Viewer receives only the permitted historical or shared view, not Resolution composition or management controls.')
rule('12_CAPTURE_BUTTON.md', 'CAPTURE requires an operating role authorized to document in the selected Property or Business, following ' + R + '. A Property Viewer and History Viewer may see permitted existing evidence but do not initiate CAPTURE. Historical attribution retains the Role and authority held when the evidence was created.')
rule('13_ESTIMATES_INVOICES.md', 'Role titles and action authority follow ' + R + '. Financial permissions are scoped separately from ordinary work access. Shared estimating, invoicing, and payment coordination require at least one paid party and the appropriate authorization. Viewer access does not grant financial creation or management authority.')
rule('31_DISCOVER.md', 'Displayed role titles and publishing eligibility follow ' + R + '. Pro indicates paid status, while Owner, Manager, and Lead positions retain their approved parentheses. Share RoundHouse is distinct from publishing Property or Business records. Viewer access does not authorize public publishing; private History remains private. Shared interactions retain the required Property or Business context, paid-party eligibility, and visibility permissions.')

# The operator suite tests the same current role catalogue, not a second model.
p = '15_ADMIN_SUITE.md'
edit(p, 'It is **not** part of normal Homeowner, Trade Professional, Team Member, Commercial, Supplier, Property, or Command Center navigation. It exists so authorized Roundhouse administrators can safely operate and test the product without exposing administrative controls to ordinary users.',
     'The Admin Suite is restricted to authorized RoundHouse platform administrators. Home Admin, Trade Admin, and Supplier Admin are customer roles; their paid access does not grant platform-administration privileges.')
section(p, '# 1. Source Priority\n', '# 2. Hidden Entry', '''# 1. Governing Sources

**`../ROUNDHOUSE_ENTITY_MODEL.md`** defines Property, Business, and History. **`../ROUNDHOUSE_ROLES_AND_PERMISSIONS.md`** defines the current role categories, exact titles, authority, and subscription eligibility. **`01_ROUNDHOUSE_INTAKE_SCREENS.md`** defines intake and Back/Edit behavior.

The suite uses those sources for role selection, scenarios, and permission tests. Pro is paid status; earned Points and Status are a separate reward system. Owner, Manager, Lead, Admin, and combined positions use their approved titles.

Preserved datasets and visual assets remain available for their documented purposes.

---
''')
edit(p, '**Important:** Roundhouse no longer has Friend or Collaborator as governing People categories/base Roles. These labels may still be useful as optional relationship descriptions for a Home Team Member, Viewer, or other authorized relationship, but they must not recreate the old Role architecture.',
     'Personal relationship chips add optional description to an authorized relationship. They do not alter its approved Role, authority, permissions, or paid eligibility.')
edit(p, '**Trade Team Member · Electrical**  \n**Home Team Member · House Manager**  \n**Trade Professional · Recurring · HVAC**',
     '**Trade Professional · Electrical**\n\n**Home Pro (Manager) · House Manager**\n\n**Trade Pro (Lead) · Recurring · HVAC**')
section(p, '### Current Governing Demo Roles\n', '### Demo Isolation', '''### Current Governing Demo Roles

The Wardrobe uses four categories: **Property**, **Trade**, **Supplier**, and **History Viewer**. It offers the exact sub-role titles in **`../ROUNDHOUSE_ROLES_AND_PERMISSIONS.md`**, including parentheses and **Owner – Lead** / **Manager – Lead** combinations.

Demo setup records current subscription eligibility, granted authority, and the permission source separately from historical activity. Home Admin, Trade Admin, and Supplier Admin require paid access and do not receive an additional Pro label.

History Viewer is created with private History after the first completed Property or Business connection, rather than selected to bypass intake.
''')
section(p, 'In addition to **Create new avatar**, support optional scenario templates such as:', 'Templates should still use the real app architecture', '''In addition to **Create new avatar**, support scenarios for:

- a new account completing its first Property or Business connection;
- Homeowner and each Home Pro position, Home Admin, and Home (Viewer);
- Trade Professional, Trade Admin, and each Trade Pro position;
- Supplier, Supplier Admin, and each Supplier Pro position;
- authorized participation in a Commercial Property;
- History Viewer with past and present contributions;
- either side supplying the paid subscription, and both sides free;
- the one-Property and one-Business free creation limits;
- Role changes and loss of the final working relationship while History remains;
- independent and Business-derived access with different permission sources.

''')

# Terminology replacements in present-tense governing text only.
protected_names = set(PROTECTED) | {'docs/architecture/ROUNDHOUSE_ORIGINAL_VOCABULARY_AUDIT.md'}
for name in texts:
    if name in protected_names:
        continue
    s = texts[name]
    replacements = {
        'Home Team Members': 'Home Pro (Teammate) participants',
        'Home Team Member': 'Home Pro (Teammate)',
        'Trade Team Members': 'Trade participants',
        'Trade Team Member': 'Trade participant',
        'Commercial Management authorization': 'authorized Facility management',
        'Commercial Management': 'authorized Facility management',
        'Commercial Team Members': 'authorized Facility participants',
        'Commercial Team Member': 'authorized Facility participant',
    }
    for old, new in replacements.items():
        s = s.replace(old, new)
    s = s.replace('Trade Professionals and Trade participants', 'Trade participants')
    s = s.replace('Trade Professional, Trade participant,', 'Trade participant,')
    s = s.replace('base Role', 'current Role').replace('base role', 'current role')
    texts[name] = s

# Precise roster captions after replacing generic participation terminology.
for p in ('17_BUSINESS_ENTITY_SCREEN.md', '27_BUSINESS_TEAM.md'):
    name = path(p)
    texts[name] = texts[name].replace('**Trade participants**', '**Business Participants**')
    texts[name] = texts[name].replace('**Owners / Managers**', '**Owners / Managers / Admins**')
    texts[name] = texts[name].replace('Owner, Lead, and Manager are authority designations layered separately from current Role.',
        'Each person displays the exact approved sub-role title; authority and permission scope are recorded for that current relationship.')
    texts[name] = texts[name].replace('Owner, Lead, and Manager authority may be layered separately on top of the appropriate current Role.',
        'The selected sub-role title identifies the current position. Its authority and permission scope remain attached to that relationship.')

# Supporting work/record screens reference, rather than redefine, role policy.
for p in ('18_PROPERTY_MAINTENANCE_STANDARDS.md', '19_PROPERTY_ASSET_DETAIL.md',
          '20_PROPERTY_VAULT_SPECS.md', '21_PROPERTY_VAULT_DOCUMENTS_RECORDS.md',
          '22_PROPERTY_HISTORY_RECORDS.md', '23_PROPERTY_WORK.md', '24_PROPERTY_TASKS_LISTS.md',
          '25_PROPERTY_HANDOFF.md', '26_BUSINESS_WORK.md', '28_BUSINESS_PROPERTIES.md',
          '29_BUSINESS_VAULT.md', '30_PROPERTY_WORK_REQUESTS.md',
          '34_WORK_RECORD_CARDS_AND_PORTABILITY.md'):
    rule(p, 'Role titles, authority, and subscription eligibility follow ' + R + '. Each action remains limited to the current authorized scope; historical records keep their original attribution.')

# Check the edited text before writing any file.
for name, sha in PROTECTED.items():
    if texts[name] != original[name]:
        raise RuntimeError('Protected text changed: ' + name)

bad = re.compile(r'Home Team Member|Trade Team Member|Commercial Management|Commercial Team Member|Commercial Viewer|Unaffiliated|History Viewer Entity|Home Team Pro')
for name, text in texts.items():
    if name in protected_names:
        continue
    if bad.search(text):
        raise RuntimeError('Unresolved role terminology: ' + name)
    if 'UNAFFILIATED_VIEWER_LOGIC.md' in text:
        raise RuntimeError('Broken History reference: ' + name)

changed = []
for name, text in texts.items():
    if text != original[name]:
        (ROOT / name).write_text(text.rstrip() + '\n')
        changed.append(name)
print('Updated', len(changed), 'governing documentation files.')
for name in changed:
    print(name)
print('Approved Entity Model, Roles & Authority, and Intake preserved byte-for-byte.')
