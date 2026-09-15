from pathlib import Path
import hashlib
import re

protected = {
    'docs/architecture/ROUNDHOUSE_ENTITY_MODEL.md': '5f292940382888a231a372ed0788b0e572a0410b',
    'docs/architecture/ROUNDHOUSE_ROLES_AND_PERMISSIONS.md': 'bb63b777151f26e2bab9103ceef8a3d6aea374d3',
    'docs/architecture/screens/01_ROUNDHOUSE_INTAKE_SCREENS.md': '8dcd6c7b03c006aa8bcefec7a9b669b21599b551',
}
for name, expected in protected.items():
    data = Path(name).read_bytes()
    actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    assert actual == expected, 'Approved source drift: ' + name

fixes = {
    'docs/architecture/screens/15_ADMIN_SUITE.md': [
        ('not necessarily current current Roles', 'not necessarily current Roles'),
        ('10. Current Roles govern new Wardrobe scenarios; legacy Collaborator/Friend roles do not return as current Roles.',
         '10. Wardrobe scenarios use the role categories and exact sub-role titles in Roles & Authority.'),
    ],
    'docs/architecture/screens/18_PROPERTY_MAINTENANCE_STANDARDS.md': [
        ('Home Pro (Teammate) participants, Trade Professionals, and Trade participants',
         'Home Pro (Teammate) participants and Trade participants'),
    ],
}
for name, changes in fixes.items():
    p = Path(name)
    text = p.read_text()
    for old, new in changes:
        if old in text:
            assert text.count(old) == 1, name
            text = text.replace(old, new)
        else:
            assert new in text, 'Unexpected document drift: ' + name
    p.write_text(text)

stale = re.compile(r'Home Team Member|Trade Team Member|Commercial Management|Commercial Team Member|Commercial Viewer|Unaffiliated|History Viewer Entity|Home Team Pro', re.I)
count = 0
for p in Path('docs').rglob('*.md'):
    if p.name == 'ROUNDHOUSE_ORIGINAL_VOCABULARY_AUDIT.md':
        continue
    text = p.read_text()
    assert not stale.search(text), 'Unresolved current role terminology: ' + str(p)
    assert 'UNAFFILIATED_VIEWER_LOGIC.md' not in text, 'Unresolved History link: ' + str(p)
    for link in re.findall(r'`([^`\n]+\.md)`', text) + re.findall(r'\]\(([^)]+\.md)\)', text):
        assert (p.parent / link).exists(), 'Missing reference: ' + str(p) + ': ' + link
    count += 1
print('Verified', count, 'current governing Markdown documents.')
print('Approved Entity Model, Roles & Authority, and Intake are unchanged.')
print('Current role terminology and Markdown references passed.')
