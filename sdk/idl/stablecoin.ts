/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/stablecoin.json`.
 */
export type Stablecoin = {
  "address": "B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs",
  "metadata": {
    "name": "stablecoin",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Solana Stablecoin Standard — modular stablecoin program with SSS-1 and SSS-2 presets"
  },
  "instructions": [
    {
      "name": "acceptAuthority",
      "docs": [
        "Accept a pending authority transfer. Must be called by the pending authority."
      ],
      "discriminator": [
        107,
        86,
        198,
        91,
        33,
        12,
        107,
        160
      ],
      "accounts": [
        {
          "name": "newAuthority",
          "docs": [
            "The pending authority accepting the transfer."
          ],
          "signer": true
        },
        {
          "name": "config",
          "docs": [
            "The stablecoin configuration."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  99,
                  111,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "config.mint",
                "account": "stablecoinConfig"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "addToAllowlist",
      "docs": [
        "Add an address to the allowlist (SSS-3 only). Requires the blacklister role.",
        "Only allowlisted addresses can send/receive tokens in allowlist mode."
      ],
      "discriminator": [
        149,
        143,
        78,
        134,
        241,
        244,
        7,
        56
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "blacklister",
          "docs": [
            "The blacklister authority (manages both blacklist and allowlist)."
          ],
          "signer": true
        },
        {
          "name": "roles",
          "docs": [
            "Role configuration — validates the blacklister role."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  108,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "config",
          "docs": [
            "The stablecoin configuration."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  99,
                  111,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "config.mint",
                "account": "stablecoinConfig"
              }
            ]
          }
        },
        {
          "name": "allowlistEntry",
          "docs": [
            "The allowlist entry PDA — existence means the address is allowed."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  108,
                  108,
                  111,
                  119,
                  108,
                  105,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "arg",
                "path": "address"
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
          "name": "address",
          "type": "pubkey"
        },
        {
          "name": "reason",
          "type": "string"
        }
      ]
    },
    {
      "name": "addToBlacklist",
      "docs": [
        "Add an address to the blacklist (SSS-2 only). Requires the blacklister role."
      ],
      "discriminator": [
        90,
        115,
        98,
        231,
        173,
        119,
        117,
        176
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "blacklister",
          "docs": [
            "The blacklister authority."
          ],
          "signer": true
        },
        {
          "name": "roles",
          "docs": [
            "Role configuration — validates the blacklister role."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  108,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "config",
          "docs": [
            "The stablecoin configuration."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  99,
                  111,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "config.mint",
                "account": "stablecoinConfig"
              }
            ]
          }
        },
        {
          "name": "blacklistEntry",
          "docs": [
            "The blacklist entry PDA — existence means the address is blacklisted."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  108,
                  97,
                  99,
                  107,
                  108,
                  105,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "arg",
                "path": "address"
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
          "name": "address",
          "type": "pubkey"
        },
        {
          "name": "reason",
          "type": "string"
        }
      ]
    },
    {
      "name": "burnTokens",
      "docs": [
        "Burn stablecoin tokens from the caller's own token account."
      ],
      "discriminator": [
        76,
        15,
        51,
        254,
        229,
        215,
        121,
        66
      ],
      "accounts": [
        {
          "name": "burner",
          "docs": [
            "The token holder burning their own tokens."
          ],
          "signer": true
        },
        {
          "name": "config",
          "docs": [
            "The stablecoin configuration."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  99,
                  111,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
          "name": "mint",
          "docs": [
            "The stablecoin mint."
          ],
          "writable": true
        },
        {
          "name": "burnerTokenAccount",
          "docs": [
            "The burner's token account."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "freezeAccount",
      "docs": [
        "Freeze a token account, preventing all transfers. Requires the freezer role."
      ],
      "discriminator": [
        253,
        75,
        82,
        133,
        167,
        238,
        43,
        130
      ],
      "accounts": [
        {
          "name": "freezer",
          "docs": [
            "The freezer authority."
          ],
          "signer": true
        },
        {
          "name": "roles",
          "docs": [
            "Role configuration — validates the freezer role."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  108,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "config",
          "docs": [
            "The stablecoin configuration."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  99,
                  111,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
          "name": "mint",
          "docs": [
            "The stablecoin mint."
          ],
          "writable": true
        },
        {
          "name": "targetTokenAccount",
          "docs": [
            "The token account to freeze."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "docs": [
        "Initialize a new stablecoin with Token-2022 extensions based on params.",
        "SSS-1: mint authority + freeze authority + metadata.",
        "SSS-2: SSS-1 + permanent delegate + transfer hook."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "authority",
          "docs": [
            "The master authority for this stablecoin."
          ],
          "signer": true
        },
        {
          "name": "config",
          "docs": [
            "The stablecoin configuration PDA — derived from the mint keypair."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  99,
                  111,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
          "name": "mint",
          "docs": [
            "The stablecoin Token-2022 mint. A fresh keypair generated by the client.",
            "Initialized via CPI for dynamic extension selection.",
            "space for the selected extensions and initialize it with Token-2022."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "roles",
          "docs": [
            "Role configuration PDA."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  108,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "transferHookProgram",
          "docs": [
            "The transfer hook program (required if enable_transfer_hook is true)."
          ],
          "optional": true
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Token-2022 program."
          ],
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "initializeParams"
            }
          }
        }
      ]
    },
    {
      "name": "mintTokens",
      "docs": [
        "Mint new stablecoin tokens to a recipient. Requires an authorized minter with quota."
      ],
      "discriminator": [
        59,
        132,
        24,
        246,
        122,
        39,
        8,
        243
      ],
      "accounts": [
        {
          "name": "minter",
          "docs": [
            "The minter executing this mint operation."
          ],
          "signer": true
        },
        {
          "name": "minterConfig",
          "docs": [
            "The minter's configuration PDA — tracks quota usage."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "account",
                "path": "minter"
              }
            ]
          }
        },
        {
          "name": "config",
          "docs": [
            "The stablecoin configuration."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  99,
                  111,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
          "name": "mint",
          "docs": [
            "The stablecoin mint."
          ],
          "writable": true
        },
        {
          "name": "recipientTokenAccount",
          "docs": [
            "Recipient's token account."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "pause",
      "docs": [
        "Pause all stablecoin operations globally. Requires the pauser role."
      ],
      "discriminator": [
        211,
        22,
        221,
        251,
        74,
        121,
        193,
        47
      ],
      "accounts": [
        {
          "name": "pauser",
          "docs": [
            "The pauser authority."
          ],
          "signer": true
        },
        {
          "name": "roles",
          "docs": [
            "Role configuration — validates the pauser role."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  108,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "config",
          "docs": [
            "The stablecoin configuration."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  99,
                  111,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "config.mint",
                "account": "stablecoinConfig"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "removeFromAllowlist",
      "docs": [
        "Remove an address from the allowlist (SSS-3 only). Requires the blacklister role."
      ],
      "discriminator": [
        45,
        46,
        214,
        56,
        189,
        77,
        242,
        227
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Receives rent from closing the allowlist entry."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "blacklister",
          "docs": [
            "The blacklister authority (manages both blacklist and allowlist)."
          ],
          "signer": true
        },
        {
          "name": "roles",
          "docs": [
            "Role configuration — validates the blacklister role."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  108,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "config",
          "docs": [
            "The stablecoin configuration."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  99,
                  111,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "config.mint",
                "account": "stablecoinConfig"
              }
            ]
          }
        },
        {
          "name": "allowlistEntry",
          "docs": [
            "The allowlist entry PDA — closing it removes the address from the allowlist."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  108,
                  108,
                  111,
                  119,
                  108,
                  105,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "arg",
                "path": "address"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "address",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "removeFromBlacklist",
      "docs": [
        "Remove an address from the blacklist (SSS-2 only). Requires the blacklister role."
      ],
      "discriminator": [
        47,
        105,
        20,
        10,
        165,
        168,
        203,
        219
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Receives rent from closing the blacklist entry."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "blacklister",
          "docs": [
            "The blacklister authority."
          ],
          "signer": true
        },
        {
          "name": "roles",
          "docs": [
            "Role configuration — validates the blacklister role."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  108,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "config",
          "docs": [
            "The stablecoin configuration."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  99,
                  111,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "config.mint",
                "account": "stablecoinConfig"
              }
            ]
          }
        },
        {
          "name": "blacklistEntry",
          "docs": [
            "The blacklist entry PDA — closing it removes the address from the blacklist."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  108,
                  97,
                  99,
                  107,
                  108,
                  105,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "arg",
                "path": "address"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "address",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "seize",
      "docs": [
        "Seize tokens from an account using permanent delegate authority (SSS-2 only).",
        "Transfers tokens from the target account to a treasury account.",
        "Requires the seizer role."
      ],
      "discriminator": [
        129,
        159,
        143,
        31,
        161,
        224,
        241,
        84
      ],
      "accounts": [
        {
          "name": "seizer",
          "docs": [
            "The seizer authority."
          ],
          "signer": true
        },
        {
          "name": "roles",
          "docs": [
            "Role configuration — validates the seizer role."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  108,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "config",
          "docs": [
            "The stablecoin configuration."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  99,
                  111,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
          "name": "mint",
          "docs": [
            "The stablecoin mint (mutable for burn + mint operations)."
          ],
          "writable": true
        },
        {
          "name": "fromTokenAccount",
          "docs": [
            "The source token account to seize tokens from."
          ],
          "writable": true
        },
        {
          "name": "toTokenAccount",
          "docs": [
            "The treasury/destination token account to receive seized tokens."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "thawAccount",
      "docs": [
        "Thaw a previously frozen token account. Requires the freezer role."
      ],
      "discriminator": [
        115,
        152,
        79,
        213,
        213,
        169,
        184,
        35
      ],
      "accounts": [
        {
          "name": "freezer",
          "docs": [
            "The freezer authority (same role handles thaw)."
          ],
          "signer": true
        },
        {
          "name": "roles",
          "docs": [
            "Role configuration — validates the freezer role."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  108,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "config",
          "docs": [
            "The stablecoin configuration."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  99,
                  111,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
          "name": "mint",
          "docs": [
            "The stablecoin mint."
          ],
          "writable": true
        },
        {
          "name": "targetTokenAccount",
          "docs": [
            "The token account to thaw."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "transferAuthority",
      "docs": [
        "Initiate a two-step authority transfer. Requires the current master authority."
      ],
      "discriminator": [
        48,
        169,
        76,
        72,
        229,
        180,
        55,
        161
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Current master authority."
          ],
          "signer": true
        },
        {
          "name": "config",
          "docs": [
            "The stablecoin configuration."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  99,
                  111,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "config.mint",
                "account": "stablecoinConfig"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "unpause",
      "docs": [
        "Unpause stablecoin operations. Requires the pauser role."
      ],
      "discriminator": [
        169,
        144,
        4,
        38,
        10,
        141,
        188,
        255
      ],
      "accounts": [
        {
          "name": "pauser",
          "docs": [
            "The pauser authority."
          ],
          "signer": true
        },
        {
          "name": "roles",
          "docs": [
            "Role configuration — validates the pauser role."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  108,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "config",
          "docs": [
            "The stablecoin configuration."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  99,
                  111,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "config.mint",
                "account": "stablecoinConfig"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "updateMinter",
      "docs": [
        "Create or update a minter's configuration (quota and active status).",
        "Requires the master authority."
      ],
      "discriminator": [
        164,
        129,
        164,
        88,
        75,
        29,
        91,
        38
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "authority",
          "docs": [
            "The master authority."
          ],
          "signer": true
        },
        {
          "name": "config",
          "docs": [
            "The stablecoin configuration."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  99,
                  111,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "config.mint",
                "account": "stablecoinConfig"
              }
            ]
          }
        },
        {
          "name": "minterConfig",
          "docs": [
            "The minter configuration PDA — created if it doesn't exist."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "arg",
                "path": "minterPubkey"
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
          "name": "minterPubkey",
          "type": "pubkey"
        },
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "updateMinterParams"
            }
          }
        }
      ]
    },
    {
      "name": "updateRoles",
      "docs": [
        "Update role assignments (pauser, freezer, blacklister, seizer).",
        "Requires the master authority."
      ],
      "discriminator": [
        220,
        152,
        205,
        233,
        177,
        123,
        219,
        125
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "The master authority."
          ],
          "signer": true
        },
        {
          "name": "config",
          "docs": [
            "The stablecoin configuration."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  99,
                  111,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "config.mint",
                "account": "stablecoinConfig"
              }
            ]
          }
        },
        {
          "name": "roles",
          "docs": [
            "Role configuration PDA."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  108,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "updateRolesParams"
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "allowlistEntry",
      "discriminator": [
        42,
        59,
        88,
        1,
        124,
        138,
        92,
        236
      ]
    },
    {
      "name": "blacklistEntry",
      "discriminator": [
        218,
        179,
        231,
        40,
        141,
        25,
        168,
        189
      ]
    },
    {
      "name": "minterConfig",
      "discriminator": [
        78,
        211,
        23,
        6,
        233,
        19,
        19,
        236
      ]
    },
    {
      "name": "roleConfig",
      "discriminator": [
        60,
        138,
        76,
        113,
        196,
        104,
        162,
        73
      ]
    },
    {
      "name": "stablecoinConfig",
      "discriminator": [
        127,
        25,
        244,
        213,
        1,
        192,
        101,
        6
      ]
    }
  ],
  "events": [
    {
      "name": "accountFrozen",
      "discriminator": [
        221,
        214,
        59,
        29,
        246,
        50,
        119,
        206
      ]
    },
    {
      "name": "accountThawed",
      "discriminator": [
        49,
        63,
        73,
        105,
        129,
        190,
        40,
        119
      ]
    },
    {
      "name": "addedToAllowlist",
      "discriminator": [
        33,
        204,
        180,
        104,
        95,
        237,
        107,
        75
      ]
    },
    {
      "name": "addedToBlacklist",
      "discriminator": [
        3,
        196,
        78,
        136,
        111,
        197,
        188,
        114
      ]
    },
    {
      "name": "authorityTransferCompleted",
      "discriminator": [
        11,
        219,
        75,
        24,
        117,
        129,
        240,
        79
      ]
    },
    {
      "name": "authorityTransferInitiated",
      "discriminator": [
        194,
        206,
        0,
        50,
        236,
        124,
        236,
        147
      ]
    },
    {
      "name": "minterUpdated",
      "discriminator": [
        8,
        124,
        66,
        45,
        176,
        53,
        49,
        153
      ]
    },
    {
      "name": "removedFromAllowlist",
      "discriminator": [
        70,
        191,
        12,
        3,
        102,
        75,
        14,
        8
      ]
    },
    {
      "name": "removedFromBlacklist",
      "discriminator": [
        55,
        136,
        25,
        65,
        199,
        36,
        146,
        33
      ]
    },
    {
      "name": "rolesUpdated",
      "discriminator": [
        81,
        37,
        176,
        32,
        30,
        204,
        251,
        246
      ]
    },
    {
      "name": "stablecoinInitialized",
      "discriminator": [
        238,
        217,
        135,
        14,
        147,
        33,
        221,
        169
      ]
    },
    {
      "name": "stablecoinPaused",
      "discriminator": [
        72,
        123,
        16,
        187,
        50,
        214,
        82,
        198
      ]
    },
    {
      "name": "stablecoinUnpaused",
      "discriminator": [
        183,
        80,
        65,
        60,
        128,
        109,
        155,
        155
      ]
    },
    {
      "name": "tokensBurned",
      "discriminator": [
        230,
        255,
        34,
        113,
        226,
        53,
        227,
        9
      ]
    },
    {
      "name": "tokensMinted",
      "discriminator": [
        207,
        212,
        128,
        194,
        175,
        54,
        64,
        24
      ]
    },
    {
      "name": "tokensSeized",
      "discriminator": [
        51,
        129,
        131,
        114,
        206,
        234,
        140,
        122
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Unauthorized: caller does not have the required role"
    },
    {
      "code": 6001,
      "name": "paused",
      "msg": "Stablecoin operations are currently paused"
    },
    {
      "code": 6002,
      "name": "notPaused",
      "msg": "Stablecoin is not currently paused"
    },
    {
      "code": 6003,
      "name": "invalidAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6004,
      "name": "minterQuotaExceeded",
      "msg": "Minter quota exceeded"
    },
    {
      "code": 6005,
      "name": "minterNotActive",
      "msg": "Minter is not active"
    },
    {
      "code": 6006,
      "name": "alreadyBlacklisted",
      "msg": "Address is already blacklisted"
    },
    {
      "code": 6007,
      "name": "notBlacklisted",
      "msg": "Address is not blacklisted"
    },
    {
      "code": 6008,
      "name": "complianceNotEnabled",
      "msg": "Compliance features are not enabled on this stablecoin"
    },
    {
      "code": 6009,
      "name": "transferHookNotEnabled",
      "msg": "Transfer hook is not enabled on this stablecoin"
    },
    {
      "code": 6010,
      "name": "invalidDecimals",
      "msg": "Invalid decimals: must be between 0 and 9"
    },
    {
      "code": 6011,
      "name": "nameTooLong",
      "msg": "Name exceeds maximum length"
    },
    {
      "code": 6012,
      "name": "symbolTooLong",
      "msg": "Symbol exceeds maximum length"
    },
    {
      "code": 6013,
      "name": "uriTooLong",
      "msg": "URI exceeds maximum length"
    },
    {
      "code": 6014,
      "name": "reasonTooLong",
      "msg": "Blacklist reason exceeds maximum length"
    },
    {
      "code": 6015,
      "name": "authorityTransferPending",
      "msg": "An authority transfer is already pending"
    },
    {
      "code": 6016,
      "name": "noAuthorityTransferPending",
      "msg": "No authority transfer is pending"
    },
    {
      "code": 6017,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6018,
      "name": "invalidConfig",
      "msg": "Invalid configuration: permanent delegate requires transfer hook"
    },
    {
      "code": 6019,
      "name": "allowlistNotEnabled",
      "msg": "Allowlist features are not enabled on this stablecoin"
    },
    {
      "code": 6020,
      "name": "alreadyOnAllowlist",
      "msg": "Address is already on the allowlist"
    },
    {
      "code": 6021,
      "name": "notOnAllowlist",
      "msg": "Address is not on the allowlist"
    }
  ],
  "types": [
    {
      "name": "accountFrozen",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "account",
            "type": "pubkey"
          },
          {
            "name": "frozenBy",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "accountThawed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "account",
            "type": "pubkey"
          },
          {
            "name": "thawedBy",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "addedToAllowlist",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "address",
            "type": "pubkey"
          },
          {
            "name": "reason",
            "type": "string"
          },
          {
            "name": "allowlistedBy",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "addedToBlacklist",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "address",
            "type": "pubkey"
          },
          {
            "name": "reason",
            "type": "string"
          },
          {
            "name": "blacklistedBy",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "allowlistEntry",
      "docs": [
        "An allowlist entry for a specific address (SSS-3).",
        "Existence of this PDA means the address is allowed to transact."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stablecoinConfig",
            "docs": [
              "The stablecoin config this entry belongs to."
            ],
            "type": "pubkey"
          },
          {
            "name": "address",
            "docs": [
              "The allowlisted address."
            ],
            "type": "pubkey"
          },
          {
            "name": "reason",
            "docs": [
              "Reason for allowlisting (e.g., \"KYC verified\")."
            ],
            "type": "string"
          },
          {
            "name": "allowlistedAt",
            "docs": [
              "Unix timestamp when allowlisted."
            ],
            "type": "i64"
          },
          {
            "name": "allowlistedBy",
            "docs": [
              "Authority who allowlisted this address."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "authorityTransferCompleted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "oldAuthority",
            "type": "pubkey"
          },
          {
            "name": "newAuthority",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "authorityTransferInitiated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "currentAuthority",
            "type": "pubkey"
          },
          {
            "name": "pendingAuthority",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "blacklistEntry",
      "docs": [
        "A blacklist entry for a specific address (SSS-2).",
        "Existence of this PDA means the address is blacklisted."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stablecoinConfig",
            "docs": [
              "The stablecoin config this entry belongs to."
            ],
            "type": "pubkey"
          },
          {
            "name": "address",
            "docs": [
              "The blacklisted address."
            ],
            "type": "pubkey"
          },
          {
            "name": "reason",
            "docs": [
              "Reason for blacklisting (e.g., \"OFAC match\")."
            ],
            "type": "string"
          },
          {
            "name": "blacklistedAt",
            "docs": [
              "Unix timestamp when blacklisted."
            ],
            "type": "i64"
          },
          {
            "name": "blacklistedBy",
            "docs": [
              "Authority who blacklisted this address."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "initializeParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "uri",
            "type": "string"
          },
          {
            "name": "decimals",
            "type": "u8"
          },
          {
            "name": "enablePermanentDelegate",
            "type": "bool"
          },
          {
            "name": "enableTransferHook",
            "type": "bool"
          },
          {
            "name": "enableConfidentialTransfer",
            "type": "bool"
          },
          {
            "name": "enableAllowlist",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "minterConfig",
      "docs": [
        "Per-minter configuration with quota tracking."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "minter",
            "docs": [
              "The minter's public key."
            ],
            "type": "pubkey"
          },
          {
            "name": "stablecoinConfig",
            "docs": [
              "The stablecoin config this minter belongs to."
            ],
            "type": "pubkey"
          },
          {
            "name": "quota",
            "docs": [
              "Maximum amount this minter is allowed to mint."
            ],
            "type": "u64"
          },
          {
            "name": "minted",
            "docs": [
              "Amount already minted by this minter."
            ],
            "type": "u64"
          },
          {
            "name": "active",
            "docs": [
              "Whether this minter is active."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "minterUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "minter",
            "type": "pubkey"
          },
          {
            "name": "quota",
            "type": "u64"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "updatedBy",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "removedFromAllowlist",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "address",
            "type": "pubkey"
          },
          {
            "name": "removedBy",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "removedFromBlacklist",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "address",
            "type": "pubkey"
          },
          {
            "name": "removedBy",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "roleConfig",
      "docs": [
        "Role assignments for operational functions.",
        "Each role can be assigned to a different keypair."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stablecoinConfig",
            "docs": [
              "The stablecoin config this role set belongs to."
            ],
            "type": "pubkey"
          },
          {
            "name": "pauser",
            "docs": [
              "Authority that can pause/unpause the stablecoin."
            ],
            "type": "pubkey"
          },
          {
            "name": "freezer",
            "docs": [
              "Authority that can freeze/thaw token accounts."
            ],
            "type": "pubkey"
          },
          {
            "name": "blacklister",
            "docs": [
              "Authority that can add/remove addresses from blacklist (SSS-2)."
            ],
            "type": "pubkey"
          },
          {
            "name": "seizer",
            "docs": [
              "Authority that can seize tokens via permanent delegate (SSS-2)."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "rolesUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "updatedBy",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "stablecoinConfig",
      "docs": [
        "Global configuration for a stablecoin instance.",
        "Stores authorities, feature flags, and operational state."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "masterAuthority",
            "docs": [
              "Master authority — can update all roles and transfer authority."
            ],
            "type": "pubkey"
          },
          {
            "name": "pendingAuthority",
            "docs": [
              "Pending authority for two-step transfer. Pubkey::default() if none pending."
            ],
            "type": "pubkey"
          },
          {
            "name": "mint",
            "docs": [
              "The stablecoin Token-2022 mint address."
            ],
            "type": "pubkey"
          },
          {
            "name": "decimals",
            "docs": [
              "Decimal places for the stablecoin (typically 6)."
            ],
            "type": "u8"
          },
          {
            "name": "enablePermanentDelegate",
            "docs": [
              "Whether permanent delegate extension is enabled (SSS-2)."
            ],
            "type": "bool"
          },
          {
            "name": "enableTransferHook",
            "docs": [
              "Whether transfer hook extension is enabled (SSS-2)."
            ],
            "type": "bool"
          },
          {
            "name": "isPaused",
            "docs": [
              "Whether the stablecoin is globally paused."
            ],
            "type": "bool"
          },
          {
            "name": "totalMinted",
            "docs": [
              "Cumulative amount minted across all minters."
            ],
            "type": "u64"
          },
          {
            "name": "totalBurned",
            "docs": [
              "Cumulative amount burned."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed."
            ],
            "type": "u8"
          },
          {
            "name": "enableConfidentialTransfer",
            "docs": [
              "Whether confidential transfer extension is enabled (SSS-3)."
            ],
            "type": "bool"
          },
          {
            "name": "enableAllowlist",
            "docs": [
              "Whether allowlist mode is enabled (SSS-3). Inverts blacklist logic:",
              "only allowlisted addresses can send/receive."
            ],
            "type": "bool"
          },
          {
            "name": "reserved",
            "docs": [
              "Reserved for future upgrades."
            ],
            "type": {
              "array": [
                "u8",
                126
              ]
            }
          }
        ]
      }
    },
    {
      "name": "stablecoinInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "enablePermanentDelegate",
            "type": "bool"
          },
          {
            "name": "enableTransferHook",
            "type": "bool"
          },
          {
            "name": "enableConfidentialTransfer",
            "type": "bool"
          },
          {
            "name": "enableAllowlist",
            "type": "bool"
          },
          {
            "name": "decimals",
            "type": "u8"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "stablecoinPaused",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "pausedBy",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "stablecoinUnpaused",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "unpausedBy",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "tokensBurned",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "burner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "tokensMinted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "minter",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "tokensSeized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "from",
            "type": "pubkey"
          },
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "seizedBy",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "updateMinterParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "quota",
            "type": "u64"
          },
          {
            "name": "active",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "updateRolesParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pauser",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "freezer",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "blacklister",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "seizer",
            "type": {
              "option": "pubkey"
            }
          }
        ]
      }
    }
  ]
};
