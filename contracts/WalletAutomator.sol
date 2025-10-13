// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import {IAutomationCompatible} from "./interfaces/IAutomationCompatible.sol";
import {IWalletFactory} from "./interfaces/IWalletFactory.sol";
import {IPowerWallet} from "./interfaces/IPowerWallet.sol";

/// Upgradable automator that scans PowerWallets produced by WalletFactory and triggers upkeep.
contract WalletAutomator is Initializable, UUPSUpgradeable, OwnableUpgradeable, IAutomationCompatible {
  /// Emitted when a wallet upkeep is executed.
  event WalletUpkeepExecuted(address indexed wallet, bytes performData);
  event FactoryUpdated(address indexed factory);
  event MinSecondsBetweenRunsUpdated(uint256 minSecondsBetweenRuns);
  event ScanLimitsUpdated(uint256 maxWalletsPerScan, uint256 startIdxWalletsPerScan);

  IWalletFactory public walletFactory;
  uint256 public maxWalletsPerScan; // cap per performUpkeep iteration
  uint256 public startIdxWalletsPerScan; // start index for wallets per scan
  uint256 public minSecondsBetweenRuns; // throttle between runs
  uint256 public lastRunTimestamp; // last successful performUpkeep timestamp
  mapping(address => uint256) public lastRunByWallet; // per-wallet throttle

  /// Storage gap for upgrades
  uint256[45] private __gap; // 50 - 5 used above

  /// initializer: set factory address and sensible defaults
  function initialize(address factory) public initializer {
    require(factory != address(0), "factory=0");
    __Ownable_init(msg.sender);
    __UUPSUpgradeable_init();

    walletFactory = IWalletFactory(factory);
    maxWalletsPerScan = 50; // sensible default
    startIdxWalletsPerScan = 0;
    minSecondsBetweenRuns = 10 minutes; // sensible default

    emit FactoryUpdated(factory);
    emit ScanLimitsUpdated(maxWalletsPerScan, startIdxWalletsPerScan);
    emit MinSecondsBetweenRunsUpdated(minSecondsBetweenRuns);
  }

  function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

  /// Admin setters
  function setFactory(address factory) external onlyOwner {
    require(factory != address(0), "factory=0");
    walletFactory = IWalletFactory(factory);
    emit FactoryUpdated(factory);
  }

  function setMinSecondsBetweenRuns(uint256 _minSecondsBetweenRuns) external onlyOwner {
    require(_minSecondsBetweenRuns <= 7 days, "tooBig");
    minSecondsBetweenRuns = _minSecondsBetweenRuns;
    emit MinSecondsBetweenRunsUpdated(_minSecondsBetweenRuns);
  }

  function setScanLimits(uint256 _maxWalletsPerScan, uint256 _startWalletIdx) external onlyOwner {
    require(_maxWalletsPerScan > 0, "max=0");

    maxWalletsPerScan = _maxWalletsPerScan;
    startIdxWalletsPerScan = _startWalletIdx;
    emit ScanLimitsUpdated(_maxWalletsPerScan, _startWalletIdx);
  }

  /// Chainlink-compatible view to determine if performUpkeep should run.
  /// Returns false if we ran within the throttle window; otherwise true if at least one wallet needs upkeep.
  function checkUpkeep(bytes calldata /* checkData */) external view override returns (bool upkeepNeeded, bytes memory performData) {
    uint256 total = _totalWallets();
    (bool found, address targetWallet, bytes memory upkeepData,) = _findNextEligible(startIdxWalletsPerScan, total);
    if (found) {
      return (true, abi.encode(targetWallet, upkeepData));
    }
    return (false, bytes("") );
  }

  /// Execute upkeep by calling performUpkeep on the first wallet that needs it, up to scan cap.
  function performUpkeep(bytes calldata performData) external override {
    // If Keeper supplies performData, prefer it; otherwise scan up to cap
    if (performData.length > 0) {
      (address targetWallet, bytes memory upkeepData) = abi.decode(performData, (address, bytes));
      _performOnWallet(targetWallet, upkeepData);
      // advance window by one, wrapping by total wallet count
      uint256 totalWalletsAfterDirectPerform = _totalWallets();
      if (totalWalletsAfterDirectPerform > 0) {
        startIdxWalletsPerScan = (startIdxWalletsPerScan + 1) % totalWalletsAfterDirectPerform;
        emit ScanLimitsUpdated(maxWalletsPerScan, startIdxWalletsPerScan);
      }
      return;
    }

    uint256 totalForScan = _totalWallets();
    (bool foundNext, address nextWallet, bytes memory nextData, uint256 checkedCount) = _findNextEligible(startIdxWalletsPerScan, totalForScan);
    if (foundNext) {
      _performOnWallet(nextWallet, nextData);
      uint256 totalWalletsAfterScanPerform = _totalWallets();
      if (totalWalletsAfterScanPerform > 0) {
        startIdxWalletsPerScan = (startIdxWalletsPerScan + checkedCount + 1) % totalWalletsAfterScanPerform;
        emit ScanLimitsUpdated(maxWalletsPerScan, startIdxWalletsPerScan);
      }
      return;
    }

    uint256 totalWalletsAfterNoPerform = _totalWallets();
    if (totalWalletsAfterNoPerform > 0 && checkedCount > 0) {
      startIdxWalletsPerScan = (startIdxWalletsPerScan + checkedCount) % totalWalletsAfterNoPerform;
      emit ScanLimitsUpdated(maxWalletsPerScan, startIdxWalletsPerScan);
    }
  }

  function _performOnWallet(address walletAddr, bytes memory data) internal {
    IPowerWallet(walletAddr).performUpkeep(data);
    lastRunTimestamp = block.timestamp;
    lastRunByWallet[walletAddr] = block.timestamp;
    emit WalletUpkeepExecuted(walletAddr, data);
  }

  function _findNextEligible(uint256 startIdx, uint256 maxToCheck)
    internal
    view
    returns (
      bool found,
      address walletAddr,
      bytes memory data,
      uint256 checked
    )
  {
    address[] memory users = walletFactory.getUsers();
    uint256 total = _totalWallets();
    if (total == 0 || maxToCheck == 0) {
      return (false, address(0), bytes(""), 0);
    }
    uint256 normalizedStart = startIdx % total;

    // Flatten wallets into a single array for wrap-around indexing
    address[] memory all = new address[](total);
    uint256 k = 0;
    for (uint256 i = 0; i < users.length; i++) {
      address[] memory wallets = walletFactory.getUserWallets(users[i]);
      for (uint256 j = 0; j < wallets.length; j++) {
        all[k] = wallets[j];
        k++;
      }
    }

    checked = 0;
    uint256 limit = maxToCheck > total ? total : maxToCheck;
    for (uint256 step = 1; step <= limit; step++) {
      uint256 idx = (normalizedStart + step) % total;
      address waddr = all[idx];
      IPowerWallet w = IPowerWallet(waddr);
      if (w.isClosed() || w.automationPaused()) {
        checked++;
        continue;
      }
      (bool needed, bytes memory pdata) = w.checkUpkeep("");
      if (needed) {
        if (block.timestamp >= lastRunByWallet[waddr] + minSecondsBetweenRuns) {
          return (true, waddr, pdata, checked);
        }
      }
      checked++;
    }
    return (false, address(0), bytes(""), checked);
  }
  
  function _totalWallets() internal view returns (uint256 total) {
    address[] memory users = walletFactory.getUsers();
    for (uint256 i = 0; i < users.length; i++) {
      address[] memory wallets = walletFactory.getUserWallets(users[i]);
      total += wallets.length;
    }
  }

  /// Diagnostics
  function getScanState()
    external
    view
    returns (
      uint256 startIdx,
      uint256 maxPerScan,
      uint256 minBetweenRuns,
      uint256 lastRun,
      uint256 totalWallets
    )
  {
    startIdx = startIdxWalletsPerScan;
    maxPerScan = maxWalletsPerScan;
    minBetweenRuns = minSecondsBetweenRuns;
    lastRun = lastRunTimestamp;
    totalWallets = _totalWallets();
  }

  function getPerWalletLastRun(address[] calldata wallets)
    external
    view
    returns (uint256[] memory lastRuns)
  {
    lastRuns = new uint256[](wallets.length);
    for (uint256 i = 0; i < wallets.length; i++) {
      lastRuns[i] = lastRunByWallet[wallets[i]];
    }
  }

  function previewNextEligible(uint256 startIdx, uint256 maxToCheck)
    external
    view
    returns (
      bool found,
      address walletAddr,
      bytes memory data,
      uint256 checked
    )
  {
    return _findNextEligible(startIdx, maxToCheck);
  }

  function getAllWallets() external view returns (address[] memory flatWallets) {
    address[] memory users = walletFactory.getUsers();
    uint256 total = _totalWallets();
    flatWallets = new address[](total);
    uint256 k = 0;
    for (uint256 i = 0; i < users.length; i++) {
      address[] memory wallets = walletFactory.getUserWallets(users[i]);
      for (uint256 j = 0; j < wallets.length; j++) {
        flatWallets[k] = wallets[j];
        k++;
      }
    }
  }

  /// Returns all wallets ordered as scanning proceeds starting from current startIdx (wraps around).
  function getCurrentScanOrder() external view returns (address[] memory orderedWallets) {
    uint256 total = _totalWallets();
    orderedWallets = new address[](total);
    if (total == 0) {
      return orderedWallets;
    }

    // Build flattened list in factory order
    address[] memory users = walletFactory.getUsers();
    address[] memory all = new address[](total);
    uint256 k = 0;
    for (uint256 i = 0; i < users.length; i++) {
      address[] memory wallets = walletFactory.getUserWallets(users[i]);
      for (uint256 j = 0; j < wallets.length; j++) {
        all[k] = wallets[j];
        k++;
      }
    }

    uint256 start = startIdxWalletsPerScan % total; // inclusive start
    uint256 idx = 0;
    // Copy [start .. total-1]
    for (uint256 i = start; i < total; i++) {
      orderedWallets[idx] = all[i];
      idx++;
    }
    // Then [0 .. start-1]
    for (uint256 i = 0; i < start; i++) {
      orderedWallets[idx] = all[i];
      idx++;
    }
  }

  /// Returns the consecutive slice of wallets that would be checked this iteration,
  /// starting strictly after startIdx and not wrapping within a single scan.
  function getScanWindow(uint256 startIdx, uint256 maxToCheck)
    external
    view
    returns (address[] memory window, uint256 totalWallets)
  {
    address[] memory users = walletFactory.getUsers();
    totalWallets = _totalWallets();
    if (totalWallets == 0 || maxToCheck == 0) {
      return (new address[](0), totalWallets);
    }

    uint256 endExclusive = startIdx + maxToCheck;
    if (endExclusive > type(uint256).max - 1) {
      endExclusive = type(uint256).max - 1; // defensive, practically unreachable
    }

    uint256 scanned = 0;
    uint256 toCollect = 0;
    // First pass to compute actual collection size without wrapping and not exceeding total
    for (uint256 i = 0; i < users.length; i++) {
      address[] memory wallets = walletFactory.getUserWallets(users[i]);
      for (uint256 j = 0; j < wallets.length; j++) {
        scanned++;
        if (scanned <= startIdx) {
          continue;
        }
        if (toCollect >= maxToCheck) {
          break;
        }
        toCollect++;
      }
      if (toCollect >= maxToCheck) {
        break;
      }
    }

    window = new address[](toCollect);
    scanned = 0;
    uint256 idx = 0;
    for (uint256 i = 0; i < users.length && idx < toCollect; i++) {
      address[] memory wallets = walletFactory.getUserWallets(users[i]);
      for (uint256 j = 0; j < wallets.length && idx < toCollect; j++) {
        scanned++;
        if (scanned <= startIdx) {
          continue;
        }
        window[idx] = wallets[j];
        idx++;
      }
    }
  }

  function findWalletFlatIndex(address target)
    external
    view
    returns (bool found, uint256 index)
  {
    address[] memory users = walletFactory.getUsers();
    uint256 scanned = 0;
    for (uint256 i = 0; i < users.length; i++) {
      address[] memory wallets = walletFactory.getUserWallets(users[i]);
      for (uint256 j = 0; j < wallets.length; j++) {
        scanned++;
        if (wallets[j] == target) {
          return (true, scanned - 1); // 0-based flat index
        }
      }
    }
    return (false, 0);
  }

  function getWalletDebug(address wallet)
    external
    view
    returns (
      bool isClosed,
      bool paused,
      bool upkeepNeeded,
      bytes memory performData
    )
  {
    IPowerWallet w = IPowerWallet(wallet);
    isClosed = w.isClosed();
    paused = w.automationPaused();
    (upkeepNeeded, performData) = w.checkUpkeep("");
  }
}


