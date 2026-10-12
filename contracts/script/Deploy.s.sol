// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {StealthPay} from "../src/StealthPay.sol";

/// Deploys StealthPay and writes its address to DEPLOY_OUT (JSON).
contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        StealthPay sp = new StealthPay();
        vm.stopBroadcast();
        console.log("StealthPay", address(sp));
        string memory out = vm.envOr("DEPLOY_OUT", string(""));
        if (bytes(out).length > 0) vm.writeJson(vm.serializeAddress("d", "stealthPay", address(sp)), out);
    }
}
