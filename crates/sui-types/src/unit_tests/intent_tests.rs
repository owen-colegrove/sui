// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

use fastcrypto::traits::KeyPair;

use crate::{
    base_types::{dbg_addr, ObjectID},
    crypto::{
        AccountKeyPair, AuthorityKeyPair, AuthoritySignature, Signature, SuiAuthoritySignature,
        SuiSignature,
    },
    intent::{ChainId, Intent, IntentMessage, IntentScope, IntentVersion, PersonalMessage},
    messages::{Transaction, TransactionData},
    object::Object,
};

#[test]
fn test_personal_message_intent() {
    use crate::crypto::{get_key_pair, Signature};
    let (addr1, sec1): (_, AccountKeyPair) = get_key_pair();
    let message = "Hello".as_bytes().to_vec();
    let p_message = PersonalMessage { message };
    let p_message_bcs = bcs::to_bytes(&p_message).unwrap();

    let intent = Intent::new(
        IntentVersion::V0,
        ChainId::Testing,
        IntentScope::PersonalMessage,
    );
    let intent1 = intent.clone();
    let intent2 = intent.clone();
    let intent_bcs = bcs::to_bytes(&IntentMessage::new(intent, &p_message)).unwrap();
    assert_eq!(intent_bcs.len(), p_message_bcs.len() + 3);

    // Check that the first 3 bytes are the domain separation information.
    assert_eq!(
        &intent_bcs[..3],
        vec![
            IntentVersion::V0 as u8,
            ChainId::Testing as u8,
            IntentScope::PersonalMessage as u8,
        ]
    );

    // Check that intent's last bytes match the p_message's bsc bytes.
    assert_eq!(&intent_bcs[3..], &p_message_bcs);

    // Let's ensure we can sign and verify intents.
    let s = Signature::new_secure(&p_message, intent1, &sec1).unwrap();
    let verification = s.verify_secure(&p_message, intent2, addr1);
    assert!(verification.is_ok())
}

#[test]
fn test_authority_signature_intent() {
    use crate::crypto::get_key_pair;
    let kp: AuthorityKeyPair = get_key_pair().1;

    // Create a signed user transaction.
    let (sender, sender_key): (_, AccountKeyPair) = get_key_pair();
    let recipient = dbg_addr(2);
    let object_id = ObjectID::random();
    let object = Object::immutable_with_id_for_testing(object_id);
    let data = TransactionData::new_transfer_sui(
        recipient,
        sender,
        None,
        object.compute_object_reference(),
        10000,
    );
    let data1 = data.clone();
    let signature = Signature::new_secure(&data, Intent::default(), &sender_key).unwrap();
    let tx = Transaction::new(data, signature);
    let intent_bcs = bcs::to_bytes(&IntentMessage::new(Intent::default(), &data1)).unwrap();

    // Check that intent's last bytes match the signed_data's bsc bytes.
    let signed_data_bcs = bcs::to_bytes(&tx.signed_data).unwrap();
    assert_eq!(&intent_bcs[3..], signed_data_bcs);

    // Let's ensure we can sign and verify intents.
    let s = AuthoritySignature::new_secure(&tx.signed_data, Intent::default(), &kp);
    let verification = s.verify_secure(&tx.signed_data, Intent::default(), kp.public().into());
    assert!(verification.is_ok())
}
