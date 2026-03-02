/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/transfer_hook.json`.
 */
export type TransferHook = {
  "address": "HgSUZDiLt8UWwzaxhCWwLPPs9zB1F7WTzCFSVmQSaLou",
  "metadata": {
    "name": "transferHook",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Transfer hook program for SSS-2 blacklist enforcement on every transfer"
  },
  "instructions": [
    {
      "name": "initializeExtraAccountMetaList",
      "docs": [
        "Initializes the ExtraAccountMetaList PDA for a given mint.",
        "This must be called before any transfer of the stablecoin can succeed,",
        "because Token-2022 will attempt to resolve the extra accounts.",
        "",
        "The extra accounts list includes:",
        "0. Stablecoin config PDA (to check pause state)",
        "1. Stablecoin program ID (for cross-program PDA derivation)",
        "2. Sender's blacklist entry PDA (derived from source token owner)",
        "3. Recipient's blacklist entry PDA (derived from dest token owner)",
        "4. Transfer hook program ID"
      ],
      "discriminator": [
        92,
        197,
        174,
        197,
        41,
        124,
        19,
        3
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "mint",
          "docs": [
            "The stablecoin mint that uses this transfer hook."
          ]
        },
        {
          "name": "extraAccountMetaList",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  120,
                  116,
                  114,
                  97,
                  45,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  45,
                  109,
                  101,
                  116,
                  97,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "stablecoinConfig",
          "type": "pubkey"
        },
        {
          "name": "stablecoinProgramId",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "initializeExtraAccountMetaListAllowlist",
      "docs": [
        "Initializes the ExtraAccountMetaList PDA for an SSS-3 (allowlist mode) mint.",
        "Uses allowlist PDA seeds instead of blacklist PDA seeds."
      ],
      "discriminator": [
        218,
        227,
        152,
        80,
        19,
        127,
        130,
        245
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "mint",
          "docs": [
            "The stablecoin mint that uses this transfer hook."
          ]
        },
        {
          "name": "extraAccountMetaList",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  120,
                  116,
                  114,
                  97,
                  45,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  45,
                  109,
                  101,
                  116,
                  97,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "stablecoinConfig",
          "type": "pubkey"
        },
        {
          "name": "stablecoinProgramId",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "transferHook",
      "docs": [
        "The transfer hook handler. Called by Token-2022 on every `transfer_checked`.",
        "For SSS-2 (blacklist mode): rejects if sender or recipient is blacklisted.",
        "For SSS-3 (allowlist mode): rejects if sender or recipient is NOT on the allowlist."
      ],
      "discriminator": [
        220,
        57,
        220,
        152,
        126,
        125,
        97,
        168
      ],
      "accounts": [
        {
          "name": "sourceToken",
          "docs": [
            "The source token account (sender)."
          ]
        },
        {
          "name": "mint",
          "docs": [
            "The stablecoin mint."
          ]
        },
        {
          "name": "destinationToken",
          "docs": [
            "The destination token account (recipient)."
          ]
        },
        {
          "name": "owner"
        },
        {
          "name": "extraAccountMetaList",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  120,
                  116,
                  114,
                  97,
                  45,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  45,
                  109,
                  101,
                  116,
                  97,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "stablecoinConfig"
        },
        {
          "name": "stablecoinProgram"
        },
        {
          "name": "senderBlacklistEntry"
        },
        {
          "name": "recipientBlacklistEntry"
        },
        {
          "name": "transferHookProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "senderBlacklisted",
      "msg": "Sender is blacklisted"
    },
    {
      "code": 6001,
      "name": "recipientBlacklisted",
      "msg": "Recipient is blacklisted"
    },
    {
      "code": 6002,
      "name": "stablecoinPaused",
      "msg": "Stablecoin is currently paused"
    },
    {
      "code": 6003,
      "name": "isNotCurrentlyTransferring",
      "msg": "The token is not currently being transferred"
    },
    {
      "code": 6004,
      "name": "senderNotOnAllowlist",
      "msg": "Sender is not on the allowlist"
    },
    {
      "code": 6005,
      "name": "recipientNotOnAllowlist",
      "msg": "Recipient is not on the allowlist"
    }
  ]
};
