<?php
/*
 * Test personas for the local SimpleSAMLphp IdP (docker compose --profile saml up).
 * DEVELOPMENT ONLY. Attributes mirror what the campus Shibboleth IdP releases
 * (eduPerson schema). Usernames match the seeded people in apps/api/src/db/seed.ts.
 *
 * Password for every persona: <netid>-test   (e.g. rmartinez / rmartinez-test)
 */
$persona = function ($netid, $name, array $affiliation, array $groups = array()) {
    return array(
        'uid' => array($netid),
        'eduPersonPrincipalName' => array($netid . '@college.example.edu'),
        'mail' => array($netid . '@college.example.edu'),
        'displayName' => array($name),
        'eduPersonAffiliation' => $affiliation,
        'isMemberOf' => $groups,
    );
};

$config = array(
    'admin' => array('core:AdminPassword'),

    'example-userpass' => array(
        'exampleauth:UserPass',
        'rmartinez:rmartinez-test' => $persona('rmartinez', 'Rosa Martinez', array('staff', 'employee', 'member'), array('sched-admins')),
        'kokafor:kokafor-test' => $persona('kokafor', 'Kevin Okafor', array('staff', 'employee', 'member'), array('sched-schedulers')),
        'anguyen:anguyen-test' => $persona('anguyen', 'Alicia Nguyen', array('staff', 'employee', 'member')),
        'mwhitfield:mwhitfield-test' => $persona('mwhitfield', 'Margaret Whitfield', array('faculty', 'staff', 'employee', 'member')),
        'dchen:dchen-test' => $persona('dchen', 'David Chen', array('faculty', 'employee', 'member')),
        'egrant:egrant-test' => $persona('egrant', 'Emily Grant', array('faculty', 'employee', 'member')),
        'praman:praman-test' => $persona('praman', 'Priya Raman', array('staff', 'employee', 'member')),
        'jlee:jlee-test' => $persona('jlee', 'Jordan Lee', array('student', 'member')),
        // Someone the app has never seen: signing in creates their account and personal calendar.
        'newhire:newhire-test' => $persona('newhire', 'Sam Newhire', array('faculty', 'employee', 'member')),
    ),
);
