// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockPowerWallet {
  bool public isClosed;
  bool public automationPaused;
  bool public needsUpkeep;
  bytes public lastPerformData;

  function setClosed(bool v) external { isClosed = v; }
  function setAutomationPaused(bool v) external { automationPaused = v; }
  function setNeedsUpkeep(bool v) external { needsUpkeep = v; }

  function checkUpkeep(bytes calldata) external view returns (bool, bytes memory) {
    return (needsUpkeep, bytes("mock"));
  }

  function performUpkeep(bytes calldata data) external {
    lastPerformData = data;
    needsUpkeep = false;
  }
}


