import type { Address } from '../kit'

// Every Aave v3 market on a chain Zodiac supports, by chain id and market
// name. Generated from `@bgd-labs/aave-address-book` (Aave's canonical
// registry), which `index.test.ts` checks this against, so it ships with the
// package instead of the 14 MB registry. Reserves listed on chain since the
// registry's last release are appended by hand, after checking their ids on
// chain.
//
// Left out:
// - Ethereum Horizon, a permissioned market for whitelisted RWA holders.
// - Ink's white-label deployment (`AaveV3InkWhitelabel`), a separately
//   branded instance rather than an Aave market.
// - Testnets (Sepolia, Base Sepolia).

export type AaveMarket = {
  pool: Address
  /** The market's incentives controller, which pays out supply rewards. */
  rewardsController: Address
  /**
   * Whether the pool is an L2Pool, which also takes calldata-compressed calls
   * like `withdraw(bytes32)` that name the reserve by its id. Checked against
   * each pool's bytecode; the registry only marks some of them (L2_ENCODER).
   */
  l2Pool: boolean
  /**
   * The WrappedTokenGatewayV3 that wraps the chain's native token into
   * `wrapped`, one of the reserves. Missing where the market has no gateway or
   * doesn't list the wrapped native token.
   */
  gateway?: {
    address: Address
    /** The native token's symbol. */
    native: string
    wrapped: Address
    /** The aToken and variable debt token of `wrapped`. */
    aToken: Address
    variableDebtToken: Address
  }
  /**
   * `[symbol, underlying]` of every reserve, in reserve id order. Symbols are
   * the tokens' own (₮ spelled T), except that bridged USDC is "USDC.e" where
   * the market also lists native USDC under the same symbol. They only name
   * the tokens in labels.
   */
  reserves: readonly (readonly [symbol: string, underlying: Address])[]
}

export const AAVE_V3 = {
  1: {
    // Ethereum
    Core: {
      pool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
      rewardsController: '0x8164Cc65827dcFe994AB23944CBC90e0aa80bFcb',
      l2Pool: false,
      gateway: {
        address: '0xd01607c3C5eCABa394D8be377a08590149325722',
        native: 'ETH',
        wrapped: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        aToken: '0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8',
        variableDebtToken: '0xeA51d7853EEFb32b6ee06b1C12E6dcCA88Be0fFE',
      },
      reserves: [
        ['WETH', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'],
        ['wstETH', '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'],
        ['WBTC', '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'],
        ['USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
        ['DAI', '0x6B175474E89094C44Da98b954EedeAC495271d0F'],
        ['LINK', '0x514910771AF9Ca656af840dff83E8264EcF986CA'],
        ['AAVE', '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9'],
        ['cbETH', '0xBe9895146f7AF43049ca1c1AE358B0541Ea49704'],
        ['USDT', '0xdAC17F958D2ee523a2206206994597C13D831ec7'],
        ['rETH', '0xae78736Cd615f374D3085123A210448E74Fc6393'],
        ['LUSD', '0x5f98805A4E8be255a32880FDeC7F6728C6568bA0'],
        ['CRV', '0xD533a949740bb3306d119CC777fa900bA034cd52'],
        ['MKR', '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2'],
        ['SNX', '0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F'],
        ['BAL', '0xba100000625a3754423978a60c9317c58a424e3D'],
        ['UNI', '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'],
        ['LDO', '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32'],
        ['ENS', '0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72'],
        ['1INCH', '0x111111111117dC0aa78b770fA6A738034120C302'],
        ['FRAX', '0x853d955aCEf822Db058eb8505911ED77F175b99e'],
        ['GHO', '0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f'],
        ['RPL', '0xD33526068D116cE69F19A9ee46F0bd304F21A51f'],
        ['sDAI', '0x83F20F44975D03b1b09e64809B757c47f942BEeA'],
        ['STG', '0xAf5191B0De278C7286d6C7CC6ab6BB8A73bA2Cd6'],
        ['KNC', '0xdeFA4e8a7bcBA345F687a2f1456F5Edd9CE97202'],
        ['FXS', '0x3432B6A60D23Ca0dFCa7761B7ab56459D9C964D0'],
        ['crvUSD', '0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E'],
        ['PYUSD', '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8'],
        ['weETH', '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee'],
        ['osETH', '0xf1C9acDc66974dFB6dEcB12aA385b9cD01190E38'],
        ['USDe', '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3'],
        ['ETHx', '0xA35b1B31Ce002FBF2058D22F30f95D405200A15b'],
        ['sUSDe', '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497'],
        ['tBTC', '0x18084fbA666a33d37592fA2633fD49a74DD93a88'],
        ['cbBTC', '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'],
        ['USDS', '0xdC035D45d973E3EC169d2276DDab16f1e407384F'],
        ['rsETH', '0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7'],
        ['LBTC', '0x8236a87084f8B84306f72007F36F2618A5634494'],
        ['eBTC', '0x657e8C867D8B37dCC18fA4Caead9C45EB088C642'],
        ['RLUSD', '0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD'],
        ['PT-eUSDE-29MAY2025', '0x50D2C7992b802Eef16c04FeADAB310f31866a545'],
        ['PT-sUSDE-31JUL2025', '0x3b3fB9C57858EF816833dC91565EFcd85D96f634'],
        ['USDtb', '0xC139190F447e929f090Edeb554D95AbB8b18aC1C'],
        ['PT-USDe-31JUL2025', '0x917459337CaAC939D41d7493B3999f571D20D667'],
        ['PT-eUSDE-14AUG2025', '0x14Bdc3A3AE09f5518b923b69489CBcAfB238e617'],
        ['eUSDe', '0x90D2af7d622ca3141efA4d8f1F24d86E5974Cc8F'],
        ['FBTC', '0xC96dE26018A54D51c097160568752c4E3BD6C364'],
        ['EURC', '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c'],
        ['PT-sUSDE-25SEP2025', '0x9F56094C450763769BA0EA9Fe2876070c0fD5F77'],
        ['PT-USDe-25SEP2025', '0xBC6736d346a5eBC0dEbc997397912CD9b8FAe10a'],
        ['tETH', '0xD11c452fc99cF405034ee446803b6F6c1F6d5ED8'],
        ['ezETH', '0xbf5495Efe5DB9ce00f80364C8B423567e58d2110'],
        ['XAUt', '0x68749665FF8D2d112Fa859AA293F07A622782F38'],
        ['PT-sUSDE-27NOV2025', '0xe6A934089BBEe34F832060CE98848359883749B3'],
        ['PT-USDe-27NOV2025', '0x62C6E813b9589C3631Ba0Cdb013acdB8544038B7'],
        ['PT-USDe-5FEB2026', '0x1F84a51296691320478c98b8d77f2Bbd17D34350'],
        ['PT-sUSDE-5FEB2026', '0xE8483517077afa11A9B07f849cee2552f040d7b2'],
        ['mUSD', '0xacA92E438df0B2401fF60dA7E4337B687a2435DA'],
        ['syrupUSDT', '0x356B8d89c1e1239Cbbb9dE4815c39A1474d5BA7D'],
        ['USDG', '0xe343167631d89B6Ffc58B88d6b7fB0228795491D'],
        ['PT-USDe-7MAY2026', '0xAeBf0Bb9f57E89260d57f31AF34eB58657d96Ce0'],
        ['PT-sUSDE-7MAY2026', '0x3de0ff76E8b528C092d47b9DaC775931cef80F49'],
        ['PT-srUSDe-2APR2026', '0x9Bf45ab47747F4B4dD09B3C2c73953484b4eB375'],
        // Listed on chain after the registry's last release
        ['BTC.b', '0xB0F70C0bD6FD87dbEb7C10dC692a2a6106817072'],
        ['PT-srUSDe-25JUN2026', '0x619D75E3b790eBC21c289f2805Bb7177A7D732E2'],
        ['PT-USDG-28MAY2026', '0x9db38D74a0D29380899aD354121DfB521aDb0548'],
        ['PT-srUSDe-22OCT2026', '0x59bC9FaE5D62B19d4f8d07D758047aCb9EE19d34'],
      ],
    },
    // The registry's "Lido" market, which the Aave app calls Prime
    Prime: {
      pool: '0x4e033931ad43597d96D6bcc25c280717730B58B1',
      rewardsController: '0x8164Cc65827dcFe994AB23944CBC90e0aa80bFcb',
      l2Pool: false,
      gateway: {
        address: '0x3167C452fA3fa1e5C16bB83Bc0fde4519C464299',
        native: 'ETH',
        wrapped: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        aToken: '0xfA1fDbBD71B0aA16162D76914d69cD8CB3Ef92da',
        variableDebtToken: '0x91b7d78BF92db564221f6B5AeE744D1727d1Dd1e',
      },
      reserves: [
        ['wstETH', '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'],
        ['WETH', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'],
        ['USDS', '0xdC035D45d973E3EC169d2276DDab16f1e407384F'],
        ['USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
        ['ezETH', '0xbf5495Efe5DB9ce00f80364C8B423567e58d2110'],
        ['sUSDe', '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497'],
        ['GHO', '0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f'],
        ['rsETH', '0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7'],
        ['tETH', '0xD11c452fc99cF405034ee446803b6F6c1F6d5ED8'],
      ],
    },
    EtherFi: {
      pool: '0x0AA97c284e98396202b6A04024F5E2c65026F3c0',
      rewardsController: '0x8164Cc65827dcFe994AB23944CBC90e0aa80bFcb',
      l2Pool: false,
      reserves: [
        ['weETH', '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee'],
        ['USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
        ['PYUSD', '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8'],
        ['FRAX', '0x853d955aCEf822Db058eb8505911ED77F175b99e'],
      ],
    },
  },
  10: {
    // Optimism
    Core: {
      pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
      rewardsController: '0x929EC64c34a17401F460460D4B9390518E5B473e',
      l2Pool: true,
      gateway: {
        address: '0x5f2508cAE9923b02316254026CD43d7902866725',
        native: 'ETH',
        wrapped: '0x4200000000000000000000000000000000000006',
        aToken: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8',
        variableDebtToken: '0x0c84331e39d6658Cd6e6b9ba04736cC4c4734351',
      },
      reserves: [
        ['DAI', '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1'],
        ['LINK', '0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6'],
        ['USDC.e', '0x7F5c764cBc14f9669B88837ca1490cCa17c31607'],
        ['WBTC', '0x68f180fcCe6836688e9084f035309E29Bf0A2095'],
        ['WETH', '0x4200000000000000000000000000000000000006'],
        ['USDT', '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58'],
        ['AAVE', '0x76FB31fb4af56892A25e32cFC43De717950c9278'],
        ['sUSD', '0x8c6f28f2F1A3C87F0f938b96d27520d9751ec8d9'],
        ['OP', '0x4200000000000000000000000000000000000042'],
        ['wstETH', '0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb'],
        ['LUSD', '0xc40F949F8a4e094D1b49a23ea9241D289B7b2819'],
        ['MAI', '0xdFA46478F9e5EA86d57387849598dbFB2e964b02'],
        ['rETH', '0x9Bcef72be871e61ED4fBbc7630889beE758eb81D'],
        ['USDC', '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85'],
      ],
    },
  },
  56: {
    // BNB Chain
    Core: {
      pool: '0x6807dc923806fE8Fd134338EABCA509979a7e0cB',
      rewardsController: '0xC206C2764A9dBF27d599613b8F9A63ACd1160ab4',
      l2Pool: false,
      gateway: {
        address: '0x0c2C95b24529664fE55D4437D7A31175CFE6c4f7',
        native: 'BNB',
        wrapped: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        aToken: '0x9B00a09492a626678E5A3009982191586C444Df9',
        variableDebtToken: '0x0E76414d433ddfe8004d2A7505d218874875a996',
      },
      reserves: [
        ['Cake', '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'],
        ['WBNB', '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'],
        ['BTCB', '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c'],
        ['ETH', '0x2170Ed0880ac9A755fd29B2688956BD959F933F8'],
        ['USDC', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'],
        ['USDT', '0x55d398326f99059fF775485246999027B3197955'],
        ['FDUSD', '0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409'],
        ['wstETH', '0x26c5e01524d2E6280A48F2c50fF6De7e52E9611C'],
      ],
    },
  },
  100: {
    // Gnosis
    Core: {
      pool: '0xb50201558B00496A145fE76f7424749556E326D8',
      rewardsController: '0xaD4F91D26254B6B0C6346b390dDA2991FDE2F20d',
      l2Pool: false,
      gateway: {
        address: '0x721B9abAb6511b46b9ee83A1aba23BDAcB004149',
        native: 'XDAI',
        wrapped: '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d',
        aToken: '0xd0Dd6cEF72143E22cCED4867eb0d5F2328715533',
        variableDebtToken: '0x281963D7471eCdC3A2Bd4503e24e89691cfe420D',
      },
      reserves: [
        ['WETH', '0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1'],
        ['wstETH', '0x6C76971f98945AE98dD7d4DFcA8711ebea946eA6'],
        ['GNO', '0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb'],
        ['USDC', '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83'],
        ['WXDAI', '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d'],
        ['EURe', '0xcB444e90D8198415266c6a2724b7900fb12FC56E'],
        ['sDAI', '0xaf204776c7245bF4147c2612BF6e5972Ee483701'],
        ['USDC.e', '0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0'],
        ['GHO', '0xfc421aD3C883Bf9E7C4f42dE845C4e4405799e73'],
      ],
    },
  },
  137: {
    // Polygon
    Core: {
      pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
      rewardsController: '0x929EC64c34a17401F460460D4B9390518E5B473e',
      l2Pool: false,
      gateway: {
        address: '0xBC302053db3aA514A3c86B9221082f162B91ad63',
        native: 'POL',
        wrapped: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
        aToken: '0x6d80113e533a2C0fe82EaBD35f1875DcEA89Ea97',
        variableDebtToken: '0x4a1c3aD6Ed28a636ee1751C69071f6be75DEb8B8',
      },
      reserves: [
        ['DAI', '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063'],
        ['LINK', '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39'],
        ['USDC.e', '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'],
        ['WBTC', '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6'],
        ['WETH', '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619'],
        ['USDT0', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'],
        ['AAVE', '0xD6DF932A45C0f255f85145f286eA0b292B21C90B'],
        ['WPOL', '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'],
        ['CRV', '0x172370d5Cd63279eFa6d502DAB29171933a610AF'],
        ['SUSHI', '0x0b3F868E0BE5597D5DB7fEB59E1CADBb0fdDa50a'],
        ['GHST', '0x385Eeac5cB85A38A9a07A70c73e0a3271CfB54A7'],
        ['BAL', '0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A3'],
        ['DPI', '0x85955046DF4668e1DD369D2DE9f3AEB98DD2A369'],
        ['EURS', '0xE111178A87A3BFf0c8d18DECBa5798827539Ae99'],
        ['jEUR', '0x4e3Decbb3645551B8A19f0eA1678079FCB33fB4c'],
        ['EURA', '0xE0B52e49357Fd4DAf2c15e02058DCE6BC0057db4'],
        ['miMATIC', '0xa3Fa99A148fA48D14Ed51d610c367C61876997F1'],
        ['stMATIC', '0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C4'],
        ['MaticX', '0xfa68FB4628DFF1028CFEc22b4162FCcd0d45efb6'],
        ['wstETH', '0x03b54A6e9a984069379fae1a4fC4dBAE93B3bCCD'],
        ['USDC', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'],
      ],
    },
  },
  146: {
    // Sonic
    Core: {
      pool: '0x5362dBb1e601abF3a4c14c22ffEdA64042E5eAA3',
      rewardsController: '0x24bD6e9ca54F1737467DEf82dCA9702925B3Aa59',
      l2Pool: false,
      gateway: {
        address: '0x061D8e131F26512348ee5FA42e2DF1bA9d6505E9',
        native: 'S',
        wrapped: '0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38',
        aToken: '0x6C5E14A212c1C3e4Baf6f871ac9B1a969918c131',
        variableDebtToken: '0xF6089B790Fbf8F4812a79a31CFAbeB00B06BA7BD',
      },
      reserves: [
        ['WETH', '0x50c42dEAcD8Fc9773493ED674b675bE577f2634b'],
        ['USDC', '0x29219dd400f2Bf60E5a23d13Be72B486D4038894'],
        ['wS', '0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38'],
        ['stS', '0xE5DA20F15420aD15DE0fa650600aFc998bbE3955'],
      ],
    },
  },
  4326: {
    // MegaETH
    Core: {
      pool: '0x7e324AbC5De01d112AfC03a584966ff199741C28',
      rewardsController: '0x3691FF69e22c1353df9F8b2c0B1B16aA5fEEc389',
      l2Pool: true,
      gateway: {
        address: '0xa119F84bC1b8083F5061E4cf53705cBf1065bA27',
        native: 'ETH',
        wrapped: '0x4200000000000000000000000000000000000006',
        aToken: '0xa31E6b433382062e8A1dA41485f7b234D97c3f4d',
        variableDebtToken: '0x09ADCCC7AF2aBD356c18A4CadF2e5cC250f300E9',
      },
      reserves: [
        ['WETH', '0x4200000000000000000000000000000000000006'],
        ['BTC.b', '0xB0F70C0bD6FD87dbEb7C10dC692a2a6106817072'],
        ['USDT0', '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb'],
        ['USDm', '0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7'],
        ['wstETH', '0x601aC63637933D88285A025C685AC4e9a92a98dA'],
        ['wrsETH', '0x4Fc44BE15e9B6E30C1E774E2C87A21D3E8b5403F'],
        ['ezETH', '0x09601A65e7de7BC8A19813D263dD9E98bFdC3c57'],
        // Listed on chain after the registry's last release
        ['USDe', '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34'],
        ['stcUSD', '0x88887bE419578051FF9F4eb6C858A951921D8888'],
      ],
    },
  },
  5000: {
    // Mantle
    Core: {
      pool: '0x458F293454fE0d67EC0655f3672301301DD51422',
      rewardsController: '0x682482a584eE20fefc01f4575c45C5d84de6F619',
      l2Pool: true,
      gateway: {
        address: '0x9C6cCAC66b1c9AbA4855e2dD284b9e16e41E06eA',
        native: 'MNT',
        wrapped: '0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8',
        aToken: '0x85d86061e94CE01D3DA0f9EFa289c86ff136125a',
        variableDebtToken: '0x9c27A8ffacAbdEE0Ac5c415E018D295BB6444F0E',
      },
      reserves: [
        ['WETH', '0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111'],
        ['WMNT', '0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8'],
        ['USDT0', '0x779Ded0c9e1022225f8E0630b35a9b54bE713736'],
        ['USDC', '0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9'],
        ['USDe', '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34'],
        ['sUSDe', '0x211Cc4DD073734dA055fbF44a2b4667d5E5fE5d2'],
        ['FBTC', '0xC96dE26018A54D51c097160568752c4E3BD6C364'],
        ['syrupUSDT', '0x051665f2455116e929b9972c36d23070F5054Ce0'],
        ['wrsETH', '0x93e855643e940D025bE2e529272e4Dbd15a2Cf74'],
        ['GHO', '0xfc421aD3C883Bf9E7C4f42dE845C4e4405799e73'],
      ],
    },
  },
  8453: {
    // Base
    Core: {
      pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
      rewardsController: '0xf9cc4F0D883F1a1eb2c253bdb46c254Ca51E1F44',
      l2Pool: true,
      gateway: {
        address: '0xa0d9C1E9E48Ca30c8d8C3B5D69FF5dc1f6DFfC24',
        native: 'ETH',
        wrapped: '0x4200000000000000000000000000000000000006',
        aToken: '0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7',
        variableDebtToken: '0x24e6e0795b3c7c71D965fCc4f371803d1c1DcA1E',
      },
      reserves: [
        ['WETH', '0x4200000000000000000000000000000000000006'],
        ['cbETH', '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22'],
        ['USDbC', '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA'],
        ['wstETH', '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452'],
        ['USDC', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'],
        ['weETH', '0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A'],
        ['cbBTC', '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'],
        ['ezETH', '0x2416092f143378750bb29b79eD961ab195CcEea5'],
        ['GHO', '0x6Bb7a212910682DCFdbd5BCBb3e28FB4E8da10Ee'],
        ['wrsETH', '0xEDfa23602D0EC14714057867A78d01e94176BEA0'],
        ['LBTC', '0xecAc9C5F704e954931349Da37F60E39f515c11c1'],
        ['EURC', '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42'],
        ['AAVE', '0x63706e401c06ac8513145b7687A14804d17f814b'],
        ['tBTC', '0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b'],
        ['syrupUSDC', '0x660975730059246A68521a3e2FBD4740173100f5'],
      ],
    },
  },
  9745: {
    // Plasma
    Core: {
      pool: '0x925a2A7214Ed92428B5b1B090F80b25700095e12',
      rewardsController: '0x3A57eAa3Ca3794D66977326af7991eB3F6dD5a5A',
      l2Pool: false,
      gateway: {
        address: '0x54BDcc37c4143f944A3EE51C892a6cBDF305E7a0',
        native: 'XPL',
        wrapped: '0x6100E367285b01F48D07953803A2d8dCA5D19873',
        aToken: '0x5aA4bc74811D672DA5308019dA4779f673e60B47',
        variableDebtToken: '0x7ec35d7008682c33dBC6b214E01D919e8d441e48',
      },
      reserves: [
        ['USDT0', '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb'],
        ['USDe', '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34'],
        ['sUSDe', '0x211Cc4DD073734dA055fbF44a2b4667d5E5fE5d2'],
        ['XAUt0', '0x1B64B9025EEbb9A6239575dF9Ea4b9Ac46D4d193'],
        ['weETH', '0xA3D68b74bF0528fdD07263c60d6488749044914b'],
        ['WETH', '0x9895D81bB462A195b4922ED7De0e3ACD007c32CB'],
        ['PT-USDe-15JAN2026', '0x93B544c330F60A2aa05ceD87aEEffB8D38FD8c9a'],
        ['PT-sUSDE-15JAN2026', '0x02FCC4989B4C9D435b7ceD3fE1Ba4CF77BBb5Dd8'],
        ['wstETH', '0xe48D935e6C9e735463ccCf29a7F11e32bC09136E'],
        ['wrsETH', '0xe561FE05C39075312Aa9Bc6af79DdaE981461359'],
        ['syrupUSDT', '0xC4374775489CB9C56003BF2C9b12495fC64F0771'],
        ['WXPL', '0x6100E367285b01F48D07953803A2d8dCA5D19873'],
        ['PT-sUSDE-9APR2026', '0xab509448ad489e2E1341e25CC500f2596464Cc82'],
        ['PT-USDe-9APR2026', '0x54Dc267be2839303ff1e323584A16e86CeC4Aa44'],
        // Listed on chain after the registry's last release
        ['GHO', '0xb77E872A68C62CfC0dFb02C067Ecc3DA23B4bbf3'],
        ['PT-USDe-18JUN2026', '0x23B17d3944742ACe3d0C71586FcB320d1e4a1Ed2'],
        ['PT-sUSDE-18JUN2026', '0x30559E3d35e33AB69399a3fe9F383d32bd3c016E'],
        ['PT-sUSDE-22OCT2026', '0xf7fB83435F455Bd970F2D9f943f4eECE1941b3e9'],
      ],
    },
  },
  42161: {
    // Arbitrum
    Core: {
      pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
      rewardsController: '0x929EC64c34a17401F460460D4B9390518E5B473e',
      l2Pool: true,
      gateway: {
        address: '0x5283BEcEd7ADF6D003225C13896E536f2D4264FF',
        native: 'ETH',
        wrapped: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
        aToken: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8',
        variableDebtToken: '0x0c84331e39d6658Cd6e6b9ba04736cC4c4734351',
      },
      reserves: [
        ['DAI', '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1'],
        ['LINK', '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4'],
        ['USDC.e', '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8'],
        ['WBTC', '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f'],
        ['WETH', '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'],
        ['USDT0', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'],
        ['AAVE', '0xba5DdD1f9d7F570dc94a51479a000E3BCE967196'],
        ['EURS', '0xD22a58f79e9481D1a88e00c343885A588b34b68B'],
        ['wstETH', '0x5979D7b546E38E414F7E9822514be443A4800529'],
        ['MAI', '0x3F56e0c36d275367b8C502090EDF38289b3dEa0d'],
        ['rETH', '0xEC70Dcb4A1EFa46b8F2D97C310C9c4790ba5ffA8'],
        ['LUSD', '0x93b346b6BC2548dA6A1E7d98E9a421B42541425b'],
        ['USDC', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'],
        ['FRAX', '0x17FC002b466eEc40DaE837Fc4bE5c67993ddBd6F'],
        ['ARB', '0x912CE59144191C1204E64559FE8253a0e49E6548'],
        ['weETH', '0x35751007a407ca6FEFfE80b3cB397736D2cf4dbe'],
        ['GHO', '0x7dfF72693f6A4149b17e7C6314655f6A9F7c8B33'],
        ['ezETH', '0x2416092f143378750bb29b79eD961ab195CcEea5'],
        ['rsETH', '0x4186BFC76E2E237523CBC30FD220FE055156b41F'],
        ['tBTC', '0x6c84a8f1c29108F47a79964b5Fe888D4f4D0dE40'],
      ],
    },
  },
  42220: {
    // Celo
    Core: {
      pool: '0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402',
      rewardsController: '0x4725A0FdbEB14A77964bC1C221eE3a7982263103',
      l2Pool: false,
      reserves: [
        ['USDC', '0xcebA9300f2b948710d2653dD7B07f33A8B32118C'],
        ['USDT', '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e'],
        ['EURm', '0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73'],
        ['USDm', '0x765DE816845861e75A25fCA122bb6898B8B1282a'],
        ['CELO', '0x471EcE3750Da237f93B8E339c536989b8978a438'],
        ['WETH', '0xD221812de1BD094f35587EE8E174B07B6167D9Af'],
      ],
    },
  },
  43114: {
    // Avalanche
    Core: {
      pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
      rewardsController: '0x929EC64c34a17401F460460D4B9390518E5B473e',
      l2Pool: false,
      gateway: {
        address: '0x2825cE5921538d17cc15Ae00a8B24fF759C6CDaE',
        native: 'AVAX',
        wrapped: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
        aToken: '0x6d80113e533a2C0fe82EaBD35f1875DcEA89Ea97',
        variableDebtToken: '0x4a1c3aD6Ed28a636ee1751C69071f6be75DEb8B8',
      },
      reserves: [
        ['DAI.e', '0xd586E7F844cEa2F87f50152665BCbc2C279D8d70'],
        ['LINK.e', '0x5947BB275c521040051D82396192181b413227A3'],
        ['USDC', '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'],
        ['WBTC.e', '0x50b7545627a5162F82A992c33b87aDc75187B218'],
        ['WETH.e', '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB'],
        ['USDt', '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7'],
        ['AAVE.e', '0x63a72806098Bd3D9520cC43356dD78afe5D386D9'],
        ['WAVAX', '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7'],
        ['sAVAX', '0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE'],
        ['FRAX', '0xD24C2Ad096400B6FBcd2ad8B24E7acBc21A1da64'],
        ['MAI', '0x5c49b268c9841AFF1Cc3B0a418ff5c3442eE3F3b'],
        ['BTC.b', '0x152b9d0FdC40C096757F570A51E494bd4b943E50'],
        ['AUSD', '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a'],
        ['GHO', '0xfc421aD3C883Bf9E7C4f42dE845C4e4405799e73'],
        ['EURC', '0xC891EB4cbdEFf6e073e859e987815Ed1505c2ACD'],
        ['USDe', '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34'],
        ['sUSDe', '0x211Cc4DD073734dA055fbF44a2b4667d5E5fE5d2'],
        ['wrsETH', '0x7bFd4CA2a6Cf3A3fDDd645D10B323031afe47FF0'],
      ],
    },
  },
  59144: {
    // Linea
    Core: {
      pool: '0xc47b8C00b0f69a36fa203Ffeac0334874574a8Ac',
      rewardsController: '0xc67bb8F2314fA0df50cBa314c6509A7bdAD500C0',
      l2Pool: true,
      gateway: {
        address: '0x31A239f3e39c5D8BA6B201bA81ed584492Ae960F',
        native: 'ETH',
        wrapped: '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f',
        aToken: '0x787897dF92703BB3Fc4d9Ee98e15C0b8130Bf163',
        variableDebtToken: '0x0e7543a9dA61b2E71fC880685eD2945B7426a689',
      },
      reserves: [
        ['WETH', '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f'],
        ['WBTC', '0x3aAB2285ddcDdaD8edf438C1bAB47e1a9D05a9b4'],
        ['USDC', '0x176211869cA2b568f2A7D4EE941E073a821EE1ff'],
        ['USDT', '0xA219439258ca9da29E9Cc4cE5596924745e12B93'],
        ['wstETH', '0xB5beDd42000b71FddE22D3eE8a79Bd49A568fC8F'],
        ['ezETH', '0x2416092f143378750bb29b79eD961ab195CcEea5'],
        ['weETH', '0x1Bf74C010E6320bab11e2e5A532b5AC15e0b8aA6'],
        ['wrsETH', '0xD2671165570f41BBB3B0097893300b6EB6101E6C'],
        ['mUSD', '0xacA92E438df0B2401fF60dA7E4337B687a2435DA'],
      ],
    },
  },
  534352: {
    // Scroll
    Core: {
      pool: '0x11fCfe756c05AD438e312a7fd934381537D3cFfe',
      rewardsController: '0xa3f3100C4f1D0624DB9DB97b40C13885Ce297799',
      l2Pool: true,
      gateway: {
        address: '0xE79Ca44408Dae5a57eA2a9594532f1E84d2edAa4',
        native: 'ETH',
        wrapped: '0x5300000000000000000000000000000000000004',
        aToken: '0xf301805bE1Df81102C957f6d4Ce29d2B8c056B2a',
        variableDebtToken: '0xfD7344CeB1Df9Cf238EcD667f4A6F99c6Ef44a56',
      },
      reserves: [
        ['WETH', '0x5300000000000000000000000000000000000004'],
        ['USDC', '0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4'],
        ['wstETH', '0xf610A9dfB7C89644979b4A0f27063E9e7d7Cda32'],
        ['weETH', '0x01f0a31698C4d065659b9bdC21B3610292a1c506'],
        ['SCR', '0xd29687c813D741E2F938F4aC377128810E217b1b'],
      ],
    },
  },
} as const satisfies Record<number, Record<string, AaveMarket>>
